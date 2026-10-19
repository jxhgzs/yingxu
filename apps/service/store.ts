import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {createSession} from '../../packages/core/src/session.ts';
import type {SessionArchive} from '../../packages/core/src/session.ts';
import {check, validateDocument, emptyDocument} from '../../packages/core/src/document.ts';
import type {Document, Asset, Diagnostic, Imported} from '../../packages/core/src/document.ts';
import type {Command} from '../../packages/core/src/commands.ts';
import {validVideoPixelFormat} from '../../packages/core/src/video-pixels.ts';
import {compare,rational} from '../../packages/core/src/time.ts';

export const contentHash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export async function atomicJSON(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try {await handle.writeFile(JSON.stringify(data)); await handle.sync();} finally {await handle.close();}
    await fs.rename(temp, file);
    const dir = await fs.open(path.dirname(file), 'r'); try {await dir.sync();} finally {await dir.close();}
  } catch (error) {await fs.rm(temp, {force: true}); throw error;}
}
export type ProjectRecord = SessionArchive & {
  id: string; updatedAt: string; diagnostics: Diagnostic[]; provenance?: Imported['provenance'];
  requests: {id: string; hash: string; revision: number}[];
};
export class Store {
  root: string;
  projects = new Map<string, ProjectRecord>(); assets = new Map<string, Asset>();
  #queues = new Map<string, Promise<unknown>>();
  constructor(root: string) {this.root = path.resolve(root);}
  async initialize() {
    for (const dir of ['projects', 'media', 'jobs']) await fs.mkdir(path.join(this.root, dir), {recursive: true});
    try {
      const items: Asset[] = JSON.parse(await fs.readFile(path.join(this.root, 'assets.json'), 'utf8'));
      for (const a of items) this.assets.set(a.id, a);
    } catch (error: any) {if (error.code !== 'ENOENT') throw error;}
    for (const name of await fs.readdir(path.join(this.root, 'projects'))) if (/^[a-f0-9-]+\.json$/.test(name)) {
      const p = JSON.parse(await fs.readFile(path.join(this.root, 'projects', name), 'utf8')) as ProjectRecord;
      validateDocument(p.document); createSession(p.document, p); this.projects.set(p.id, p);
    }
  }
  async addAsset(asset: Asset, options:{verifiedFrameTiming?:'cfr30'}={}) {
    // The public asset value cannot grant itself a timing proof. Only registration
    // may pass the result of the actual bounded PTS scan as a separate argument.
    const verified=options.verifiedFrameTiming==='cfr30'&&asset.frameTiming==='cfr30',candidate={...asset};
    delete candidate.frameTiming;
    if(verified){check(asset.kind==='video'&&!!asset.fps&&compare(asset.fps,rational(30))===0&&typeof asset.sha256==='string'&&/^[a-f0-9]{64}$/.test(asset.sha256),'ASSET_FRAME_TIMING_IDENTITY_MISMATCH');candidate.frameTiming='cfr30';}
    const matches=(found:Asset)=>check(found.sha256===asset.sha256&&found.kind===asset.kind&&!!found.fps&&!!asset.fps&&compare(found.fps,asset.fps)===0,'ASSET_FRAME_TIMING_IDENTITY_MISMATCH');
    const pixels=asset.pixelFormat!==undefined;
    if(pixels)check(asset.kind==='video'&&validVideoPixelFormat(asset.pixelFormat),'INVALID_MEDIA_PIXEL_FORMAT');
    const display=asset.verifiedDisplayTransform!==undefined;
    if(display)check((asset.kind==='image'||asset.kind==='video')&&['identity','unsupported'].includes(asset.verifiedDisplayTransform!),'INVALID_MEDIA_DISPLAY_TRANSFORM');
    const matchPixels=(found:Asset)=>{if(pixels||display)check(typeof asset.sha256==='string'&&found.sha256===asset.sha256&&found.kind===asset.kind&&found.width===asset.width&&found.height===asset.height,pixels?'ASSET_PIXEL_FORMAT_IDENTITY_MISMATCH':'ASSET_DISPLAY_TRANSFORM_IDENTITY_MISMATCH');};
    const refreshNeeded=(found:Asset)=>(verified&&found.frameTiming!=='cfr30')||(pixels&&found.pixelFormat!==asset.pixelFormat)||(display&&found.verifiedDisplayTransform!==asset.verifiedDisplayTransform);
    const existing = this.assets.get(asset.id);
    if(existing){if(verified)matches(existing);matchPixels(existing);if(!refreshNeeded(existing))return existing;}
    // A single asset-list queue prevents uploads and metadata refreshes from losing registrations.
    return await this.#serial('assets', async () => {
      const found=this.assets.get(asset.id);
      if(found){
        if(verified)matches(found);matchPixels(found);if(!refreshNeeded(found))return found;
        const refreshed:Asset={...found,...(verified?{frameTiming:'cfr30' as const}:{}),...(pixels?{pixelFormat:asset.pixelFormat}:{}),...(display?{verifiedDisplayTransform:asset.verifiedDisplayTransform}:{})},next=[...this.assets.values()].map(item=>item.id===found.id?refreshed:item);
        await atomicJSON(path.join(this.root,'assets.json'),next);this.assets.set(found.id,refreshed);return refreshed;
      }
      const next = [...this.assets.values(), candidate]; await atomicJSON(path.join(this.root, 'assets.json'), next);
      this.assets.set(candidate.id, candidate); return candidate;
    });
  }
  async create(document = emptyDocument(), extra: Partial<Pick<ProjectRecord, 'diagnostics' | 'provenance'>> = {}) {
    validateDocument(document);
    const record: ProjectRecord = {id: randomUUID(), ...createSession(document).serialize(), updatedAt: new Date().toISOString(),
      diagnostics: [], ...extra, requests: []};
    await this.#persist(record); this.projects.set(record.id, record); return this.state(record.id);
  }
  get(id: string) {const p = this.projects.get(id); check(p, 'PROJECT_NOT_FOUND'); return p;}
  state(id: string) {
    const p = this.get(id);
    return {...createSession(p.document, p).snapshot(), id: p.id, updatedAt: p.updatedAt,
      documentHash: contentHash(p.document), diagnostics: structuredClone(p.diagnostics)};
  }
  list() {return [...this.projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(p => ({id: p.id, title: p.document.title || '未命名工程', updatedAt: p.updatedAt, revision: p.revision}));}
  async edit(id: string, request: {revision: number; requestId: string; command?: Command; action?: 'undo' | 'redo'}) {
    check(typeof request.requestId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(request.requestId), 'INVALID_REQUEST_ID');
    check(Number.isSafeInteger(request.revision) && (request.command ? !request.action : ['undo', 'redo'].includes(request.action!)), 'INVALID_COMMAND');
    return await this.#serial(id, async () => {
      const current = this.get(id), fingerprint = contentHash(request), previous = current.requests.find(r => r.id === request.requestId);
      if (previous) {check(previous.hash === fingerprint, 'REQUEST_ID_CONFLICT'); return {...this.state(id), replayed: true};}
      const session = createSession(current.document, current);
      if (request.command) session.execute(request.revision, request.command);
      else session[request.action!](request.revision);
      const archive = session.serialize();
      // Disk-backed interactive history is explicitly capped at 100 snapshots.
      archive.past = archive.past.slice(-100); archive.future = archive.future.slice(-100);
      const record: ProjectRecord = {...current, ...archive, updatedAt: new Date().toISOString(),
        requests: [...current.requests, {id: request.requestId, hash: fingerprint, revision: archive.revision}].slice(-1000)};
      await this.#persist(record); this.projects.set(id, record); return this.state(id);
    });
  }
  #persist(record: ProjectRecord) {return atomicJSON(path.join(this.root, 'projects', record.id + '.json'), record);}
  async #serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const before = this.#queues.get(key) || Promise.resolve();
    const result = before.catch(() => {}).then(task); this.#queues.set(key, result);
    try {return await result;} finally {if (this.#queues.get(key) === result) this.#queues.delete(key);}
  }
}
