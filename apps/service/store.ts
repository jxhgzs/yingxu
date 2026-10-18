import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {createSession} from '../../packages/core/src/session.ts';
import type {SessionArchive} from '../../packages/core/src/session.ts';
import {check, validateDocument, emptyDocument} from '../../packages/core/src/document.ts';
import type {Document, Asset, Diagnostic, Imported} from '../../packages/core/src/document.ts';
import type {Command} from '../../packages/core/src/commands.ts';

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
  async addAsset(asset: Asset) {
    const existing = this.assets.get(asset.id); if (existing) return existing;
    // A single asset-list queue prevents two uploads from losing each other's registration.
    return await this.#serial('assets', async () => {
      const found = this.assets.get(asset.id); if (found) return found;
      const next = [...this.assets.values(), asset]; await atomicJSON(path.join(this.root, 'assets.json'), next);
      this.assets.set(asset.id, asset); return asset;
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
