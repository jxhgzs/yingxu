import {ref, shallowRef, computed} from 'vue';
import {EditorAPI, explainError} from './api.ts';
import type {ProjectState, ProjectSummary, JobView} from './api.ts';
import type {Asset, Document, Clip} from '../../../packages/core/src/document.ts';
import type {Command,AtomicCommand} from '../../../packages/core/src/commands.ts';
import {sourceTimeAt,keyframeAtFrame} from '../../../packages/core/src/animation.ts';
import type {AnimatedProperty,Keyframe} from '../../../packages/core/src/animation.ts';
import {duration, defaultTransform} from '../../../packages/core/src/document.ts';
import {newTextClip} from '../../../packages/core/src/edits.ts';
import {rational, decimal, toNumber, add, compare, frameTime, nearestFrame} from '../../../packages/core/src/time.ts';

export type EditorOptions = {apiBase?: string; projectId?: string; onChange?: (state: ProjectState) => void};
export function atFrame(seconds: number, fps: Document['fps']) {return frameTime(nearestFrame(decimal(Math.max(0, seconds).toFixed(9)), fps).numerator, fps);}
export function timecode(seconds: number, fps = 30) {
  const frames = Math.max(0, Math.round(seconds * fps)), f = Math.round(fps), total = Math.floor(frames / f);
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60, frames % f].map(v => String(v).padStart(2, '0')).join(':');
}
export function createEditorController(options: EditorOptions = {}) {
  const api = new EditorAPI(options.apiBase), state = shallowRef<ProjectState | null>(null), assets = shallowRef<Asset[]>([]), projects = shallowRef<ProjectSummary[]>([]);
  const selectedId = ref<string | null>(null), playhead = ref(0), playing = ref(false), error = ref(''), busy = ref(false), loading = ref(true);
  const jobs = shallowRef<JobView[]>([]), preview = shallowRef<JobView | null>(null), previewPending = ref(false), zoom = ref(88), snap = ref(true);
  let disposed = false, loadEpoch = 0, pollTimer: ReturnType<typeof setTimeout> | undefined, previewTimer: ReturnType<typeof setTimeout> | undefined;
  let activePreview: string | null = null, queue: Promise<unknown> = Promise.resolve(), pending = 0;
  const doc = computed(() => state.value?.document);
  const total = computed(() => doc.value ? toNumber(duration(doc.value)) : 0);
  const selected = computed(() => doc.value?.tracks.flatMap(t => t.clips.map(c => ({clip: c, track: t, asset: doc.value!.assets.find(a => a.id === c.materialId)!}))).find(item => item.clip.id === selectedId.value));
  const readOnly = computed(() => !!state.value?.diagnostics.length);
  const report = (e: unknown) => {if (!disposed && (e as Error)?.name !== 'AbortError') error.value = explainError(e);};
  const guard = async <T>(action: () => Promise<T>): Promise<T | undefined> => {try {return await action();} catch (e) {report(e);}};
  const isCurrent = (id: string, revision?: number) => !disposed && state.value?.id === id && (revision === undefined || state.value.revision === revision);
  const refreshLists = async () => {
    const [p, a] = await Promise.all([api.get<ProjectSummary[]>('/api/projects'), api.get<Asset[]>('/api/assets')]);
    if (!disposed) {projects.value = p; assets.value = a;}
  };
  function adopt(next: ProjectState) {
    if (disposed) return; state.value = next;
    if (!next.document.tracks.some(t => t.clips.some(c => c.id === selectedId.value))) selectedId.value = null;
    playhead.value = Math.min(playhead.value, total.value); options.onChange?.(structuredClone(next));
    try {localStorage.setItem('yingxu-editor-project', next.id);} catch {}
  }
  async function poll() {
    if (disposed) return;
    const id = state.value?.id;
    if (id) try {
      const list = await api.get<JobView[]>(`/api/projects/${id}/jobs`);
      if (isCurrent(id)) {
        jobs.value = list;
        const complete = list.find(j => j.kind === 'preview' && j.documentRevision === state.value!.revision && j.status === 'completed');
        if (complete && preview.value?.id !== complete.id) preview.value = complete;
        const current = list.find(j => j.id === activePreview);
        if (current && ['completed', 'failed', 'cancelled', 'interrupted'].includes(current.status)) {
          if (current.documentRevision === state.value?.revision) previewPending.value = false;
          if (current.status === 'failed' && current.documentRevision === state.value?.revision) report(Error(current.error || 'PREVIEW_FAILED'));
          activePreview = null;
        }
      }
    } catch (e) {report(e);}
    if (!disposed) pollTimer = setTimeout(poll, 650);
  }
  function schedulePreview() {
    clearTimeout(previewTimer); playing.value = false;
    if (activePreview) {void api.post(`/api/jobs/${activePreview}/cancel`).catch(() => {}); activePreview = null;}
    if (!state.value || !total.value || readOnly.value) {preview.value = null; previewPending.value = false; return;}
    previewPending.value = true;
    const id = state.value.id, revision = state.value.revision;
    previewTimer = setTimeout(async () => {
      try {
        if (!isCurrent(id, revision)) return;
        const job = await api.post<JobView>(`/api/projects/${id}/jobs`, {revision, kind: 'preview', requestId: crypto.randomUUID()});
        if (!isCurrent(id, revision)) {void api.post(`/api/jobs/${job.id}/cancel`).catch(() => {}); return;}
        activePreview = job.id; jobs.value = [job, ...jobs.value];
      } catch (e) {if (isCurrent(id, revision)) {previewPending.value = false; report(e);}}
    }, 450);
  }
  async function loadProject(id: string) {
    await queue.catch(() => {}); const epoch = ++loadEpoch; loading.value = true;
    try {
      const next = await api.get<ProjectState & {jobs: JobView[]}>(`/api/projects/${id}`);
      if (disposed || epoch !== loadEpoch) return;
      selectedId.value = null; playhead.value = 0; playing.value = false; preview.value = null; jobs.value = next.jobs || [];
      adopt(next); error.value = '';
      const existing = jobs.value.find(j => j.kind === 'preview' && j.status === 'completed' && j.documentRevision === next.revision);
      if (existing) {preview.value = existing; previewPending.value = false;} else schedulePreview();
    } finally {if (!disposed && epoch === loadEpoch) loading.value = false;}
  }
  async function edit(command?: Command, action?: 'undo' | 'redo') {
    const id = state.value?.id; if (!id || readOnly.value) return;
    pending++; busy.value = true;
    const result = queue.catch(() => {}).then(async () => {
      if (!isCurrent(id)) throw Error('PROJECT_CHANGED');
      const revision = state.value!.revision;
      const next = await api.post<ProjectState>(`/api/projects/${id}/commands`, {revision, requestId: crypto.randomUUID(), command, action});
      if (isCurrent(id)) {adopt(next); error.value = ''; if(next.revision!==revision)schedulePreview(); void refreshLists().catch(report);}
      return next;
    });
    queue = result;
    try {return await result;} finally {pending--; if (!disposed) busy.value = pending > 0;}
  }
  async function initialize() {
    try {
      const bootstrap = await api.get('/api/bootstrap'); if (disposed) return;
      api.token = bootstrap.token; projects.value = bootstrap.projects; assets.value = bootstrap.assets;
      let remembered: string | null = null; try {remembered = localStorage.getItem('yingxu-editor-project');} catch {}
      const id = options.projectId || (projects.value.some(p => p.id === remembered) ? remembered : projects.value[0]?.id);
      if (id) await loadProject(id); else {const created = await api.post<ProjectState>('/api/projects'); adopt(created); await refreshLists();}
      void poll();
    } catch (e) {report(e);} finally {loading.value = false;}
  }
  async function addAsset(asset: Asset, trackId?: string, time?: number) {
    if (!doc.value) return;
    const mediaKind = asset.kind || 'video', kind = mediaKind === 'image' ? 'video' : mediaKind;
    const track = doc.value.tracks.find(t => t.id === trackId) || doc.value.tracks.find(t => t.kind === kind && !t.locked);
    if (!track) throw Error('TRACK_NOT_FOUND');
    if (!doc.value.assets.some(a => a.id === asset.id)) await edit({type: 'asset.add', asset});
    const startTime = time !== undefined ? atFrame(time, doc.value!.fps) : track.clips.reduce((end, c) => {
      const next = add(c.target.start, c.target.duration); return compare(next, end) > 0 ? next : end;
    }, rational(0));
    const length = asset.kind === 'image' ? rational(5) : asset.duration;
    const clip: Clip = {id: crypto.randomUUID(), materialId: asset.id, source: {start: rational(0), duration: length}, target: {start: startTime, duration: length}, speed: rational(1), editableTiming: true};
    await edit({type: 'clip.add', trackId: track.id, clip}); selectedId.value = clip.id;
  }
  async function addText() {
    if (!doc.value) return;
    let asset = doc.value.assets.find(a => a.kind === 'text');
    if (!asset) {asset = {id: 'text_' + crypto.randomUUID(), kind: 'text', path: '', name: '文字', duration: rational(3600)}; await edit({type: 'asset.add', asset});}
    const track = doc.value!.tracks.find(t => t.kind === 'text' && !t.locked); if (!track) throw Error('TRACK_NOT_FOUND');
    const clip = newTextClip(doc.value!, asset.id, crypto.randomUUID(), atFrame(playhead.value, doc.value!.fps));
    await edit({type: 'clip.add', trackId: track.id, clip}); selectedId.value = clip.id;
  }
  async function upload(files: File[]) {
    for (const file of files) {const asset = await api.upload(file); if (!disposed && !assets.value.some(a => a.id === asset.id)) assets.value = [...assets.value, asset];}
  }
  async function split() {if (selected.value && doc.value) await edit({type: 'split', clipId: selected.value.clip.id, at: atFrame(playhead.value, doc.value.fps), rightId: crypto.randomUUID()});}
  function keyframeCommand(property:AnimatedProperty,value:number,interpolation?:Keyframe['interpolation']):AtomicCommand{
    const clip=selected.value?.clip;if(!clip||!doc.value)throw Error('CLIP_NOT_FOUND');
    const head=atFrame(playhead.value,doc.value.fps),existing=keyframeAtFrame(clip,property,head,doc.value.fps),time=existing?.time||sourceTimeAt(clip,head);
    return {type:'keyframe.set',clipId:clip.id,property,point:{id:existing?.id||crypto.randomUUID(),time,value,interpolation:interpolation||existing?.interpolation||'linear'}};
  }
  async function remove(ripple = false) {if (selected.value) await edit({type: 'clip.remove', clipId: selected.value.clip.id, ripple});}
  async function duplicate() {
    if (!selected.value || !doc.value) return;
    const c = structuredClone(selected.value.clip); c.id = crypto.randomUUID();
    c.target.start = selected.value.track.clips.reduce((end, x) => toNumber(add(x.target.start, x.target.duration)) > toNumber(end) ? add(x.target.start, x.target.duration) : end, rational(0));
    await edit({type: 'clip.add', trackId: selected.value.track.id, clip: c}); selectedId.value = c.id;
  }
  async function createProject() {await queue.catch(() => {}); const next = await api.post<ProjectState>('/api/projects'); adopt(next); preview.value = null; playhead.value = 0; selectedId.value = null; playing.value = false; schedulePreview(); await refreshLists();}
  async function demo() {await queue.catch(() => {}); const next = await api.post('/api/demo'); assets.value = [...assets.value.filter(a => a.id !== next.asset.id), next.asset]; await refreshLists(); await loadProject(next.project.id);}
  async function open(document: Document) {await queue.catch(() => {}); const next = await api.post<ProjectState>('/api/open-document', {document}); await refreshLists(); await loadProject(next.id);}
  async function importFile(file: File, draft = false) {
    const raw = JSON.parse(await file.text()); await queue.catch(() => {});
    const next = await api.post<ProjectState>(draft ? '/api/import-draft' : '/api/open-document', draft ? raw : raw);
    await refreshLists(); await loadProject(next.id);
  }
  async function exportVideo(exportSettings:import('../../../packages/core/src/export.ts').ExportSettings={}) {
    await queue.catch(() => {}); if (!state.value) return;
    const key = `yingxu-pending-export:${state.value.id}:${state.value.revision}:${JSON.stringify(exportSettings)}`;
    let requestId: string | null = null; try {requestId = sessionStorage.getItem(key);} catch {}
    requestId ||= crypto.randomUUID(); try {sessionStorage.setItem(key, requestId);} catch {}
    const job = await api.post<JobView>(`/api/projects/${state.value.id}/jobs`, {revision: state.value.revision, kind: 'export', requestId,exportSettings});
    try {sessionStorage.removeItem(key);} catch {}
    jobs.value = [job, ...jobs.value]; return job;
  }
  function seek(time: number) {playhead.value = Math.min(Math.max(0,doc.value?toNumber(atFrame(time,doc.value.fps)):time),total.value);}
  function dispose() {disposed = true; clearTimeout(pollTimer); clearTimeout(previewTimer); api.dispose(); playing.value = false;}
  async function flush() {await queue;}
  return {api, state, doc, assets, projects, selectedId, selected, playhead, playing, error, busy, loading, jobs, preview, previewPending, zoom, snap, total, readOnly,
    initialize, loadProject, edit, guard, report, schedulePreview, addAsset, addText, upload, split,keyframeCommand, remove, duplicate, createProject, demo, open, importFile, exportVideo, seek, flush, dispose};
}
export type EditorController = ReturnType<typeof createEditorController>;
