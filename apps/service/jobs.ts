import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store, atomicJSON, contentHash} from './store.ts';
import {rendererFingerprint} from './engine.ts';
import {render} from '../../packages/media/src/render.ts';
import {renderGraph} from '../../packages/media/src/graph.ts';
import {fileHash, ffmpeg} from '../../packages/media/src/probe.ts';
import {check} from '../../packages/core/src/document.ts';
import {runProcess} from '../../packages/media/src/process.ts';
import type {Document} from '../../packages/core/src/document.ts';
import {resolveExportSettings} from '../../packages/core/src/export.ts';
import type {ExportSettings,ResolvedExport,ExportFormat} from '../../packages/core/src/export.ts';

export type Job = {
  id: string; projectId: string; requestId: string; requestHash: string;
  kind: 'preview' | 'export'; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'cancelling';
  documentRevision: number; documentHash: string; document: Document; inputHashes: {id: string; sha256: string}[];
  protocolVersion: 1; engine: string; progress: number; createdAt: string; error?: string; completedAt?: string;
  exportSettings?:ExportSettings; resolvedExport?:ResolvedExport;
  result?: {width: number; height: number; frameCount: number; duration: number; path: string;format?:ExportFormat;extension?:string;mime?:string};
};
export class Jobs {
  store: Store; records = new Map<string, Job>(); #controllers = new Map<string, AbortController>(); #active = false;
  #submitting: Promise<unknown> = Promise.resolve();
  engine = 'ffmpeg-reference';
  #closing = false; #drainWaiters: (() => void)[] = [];
  constructor(store: Store) {this.store = store;}
  directory(id: string) {check(/^[a-f0-9-]+$/.test(id), 'INVALID_JOB_ID'); return path.join(this.store.root, 'jobs', id);}
  async initialize() {
    const version = await runProcess(ffmpeg(), ['-version']); this.engine = version.stdout.split('\n')[0] + '|yingxu-reference-v4|' + await rendererFingerprint();
    for (const id of await fs.readdir(path.join(this.store.root, 'jobs'))) {
      if (!/^[a-f0-9-]+$/.test(id)) continue;
      let job: Job;
      try {job = JSON.parse(await fs.readFile(path.join(this.directory(id), 'job.json'), 'utf8'));} catch (error: any) {if (error.code === 'ENOENT') continue; throw error;}
      if (['running', 'queued', 'cancelling'].includes(job.status)) {job.status = 'interrupted'; job.error = '服务重启，任务已中断'; await this.#save(job);}
      this.records.set(job.id, job);
    }
  }
  get(id: string) {const job = this.records.get(id); check(job, 'JOB_NOT_FOUND'); return job;}
  public(job: Job) {const {document, result, requestHash, ...rest} = job; return {...rest, result: result && {
    width: result.width, height: result.height, frameCount: result.frameCount, duration: result.duration,
    format:result.format||'mp4',extension:result.extension||'mp4',mime:result.mime||'video/mp4',
    url: `/renders/${job.id}/video`, downloadUrl: `/renders/${job.id}/download`
  }};}
  list(projectId: string) {return [...this.records.values()].filter(j => j.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40).map(j => this.public(j));}
  async submit(projectId: string, body: {revision: number; requestId: string; kind: 'preview' | 'export';exportSettings?:ExportSettings}) {
    const task = this.#submitting.catch(() => {}).then(async () => {
      check(!this.#closing, 'SERVICE_CLOSING');
      check(['preview', 'export'].includes(body.kind) && typeof body.requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(body.requestId), 'INVALID_JOB_REQUEST');
      const fingerprint = contentHash({projectId, ...body});
      const previous = [...this.records.values()].find(j => j.projectId === projectId && j.requestId === body.requestId);
      if (previous) {check(previous.requestHash === fingerprint, 'REQUEST_ID_CONFLICT'); return this.public(previous);}
      const project = this.store.get(projectId); check(project.revision === body.revision, 'REVISION_CONFLICT');
      check(project.diagnostics.length === 0, 'UNSUPPORTED_DRAFT_EFFECTS');
      check(body.kind==='export'||body.exportSettings===undefined,'INVALID_PREVIEW_SETTINGS');
      const resolvedExport=body.kind==='export'?resolveExportSettings(project.document,body.exportSettings):undefined;
      const exportSettings:ExportSettings|undefined=resolvedExport&&{format:resolvedExport.format,size:{width:resolvedExport.width,height:resolvedExport.height},fps:resolvedExport.fps,
        videoCodec:resolvedExport.videoCodec,videoBitrateKbps:resolvedExport.videoBitrateKbps,audioSampleRate:resolvedExport.audioSampleRate,audioBitrateKbps:resolvedExport.audioBitrateKbps,range:body.exportSettings?.range};
      renderGraph(resolvedExport?{...project.document,fps:resolvedExport.fps}:project.document);
      const inputs = project.document.assets.filter(a => project.document.tracks.some(t => t.clips.some(c => c.materialId === a.id)) && a.kind !== 'text');
      for (const a of inputs) {
        const registered = this.store.assets.get(a.id);
        check(registered && registered.sha256 === a.sha256 && registered.path === a.path, 'MEDIA_NOT_LINKED', a.name || a.id);
      }
      const job: Job = {id: randomUUID(), projectId, requestId: body.requestId, requestHash: fingerprint, kind: body.kind,
        status: 'queued', documentRevision: project.revision, documentHash: contentHash(project.document), document: structuredClone(project.document),
        inputHashes: inputs.map(a => ({id: a.id, sha256: a.sha256!})), protocolVersion: 1, engine: this.engine,
        progress: 0, createdAt: new Date().toISOString(),exportSettings:structuredClone(exportSettings),resolvedExport:structuredClone(resolvedExport)};
      await this.#save(job); this.records.set(job.id, job); void this.#pump().catch(error => process.stderr.write(String(error)+'\n')); return this.public(job);
    });
    this.#submitting = task; return await task;
  }
  async cancel(id: string) {
    const job = this.get(id);
    if (job.status === 'queued') job.status = 'cancelled';
    else if (job.status === 'running') {job.status = 'cancelling'; this.#controllers.get(id)?.abort();}
    await this.#save(job); return this.public(job);
  }
  #save(job: Job) {return atomicJSON(path.join(this.directory(job.id), 'job.json'), job);}
  async shutdown() {
    this.#closing = true; await this.#submitting.catch(() => {});
    for (const controller of this.#controllers.values()) controller.abort();
    for (const job of this.records.values()) if (job.status === 'queued') {job.status='interrupted';job.error='服务已关闭，任务未执行';await this.#save(job);}
    if(this.#active)await new Promise<void>(resolve=>this.#drainWaiters.push(resolve));
  }
  async #pump() {
    if (this.#active) return; this.#active = true;
    try {
      while (true) {
        const job = !this.#closing && [...this.records.values()].find(j => j.status === 'queued'); if (!job) break;
        const controller = new AbortController(); this.#controllers.set(job.id, controller); job.status = 'running';
        try {
          await this.#save(job);
          for (const input of job.inputHashes) {
            const asset = job.document.assets.find(a => a.id === input.id)!;
            check(await fileHash(asset.path) === input.sha256, 'MEDIA_HASH_CHANGED', input.id);
          }
          const result = await render(job.document, this.directory(job.id), {preview: job.kind === 'preview',exportSettings:job.exportSettings, signal: controller.signal,
            onProgress: p => {job.progress = p;}});
          if (controller.signal.aborted) throw Error('JOB_CANCELLED');
          job.result = {path: result.path, width: result.width, height: result.height, frameCount: result.frameCount, duration: result.duration,format:result.format,extension:result.extension,mime:result.mime};
          job.status = 'completed'; job.progress = 1;
        } catch (error) {
          job.status = this.#closing ? 'interrupted' : controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error instanceof Error ? error.message : String(error);
        } finally {
          job.completedAt = new Date().toISOString(); this.#controllers.delete(job.id); await this.#save(job);
        }
      }
    } finally {this.#active = false; for(const resolve of this.#drainWaiters.splice(0))resolve();}
  }
}
