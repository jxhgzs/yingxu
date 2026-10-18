import type {Document, Asset, Diagnostic} from '../../../packages/core/src/document.ts';
export type ProjectState = {id: string; revision: number; document: Document; documentHash: string; updatedAt: string; canUndo: boolean; canRedo: boolean; diagnostics: Diagnostic[]};
export type JobView = {id: string; projectId: string; kind: 'preview' | 'export'; status: string; progress: number; documentRevision: number; createdAt: string; error?: string;
  result?: {width: number; height: number; duration: number; frameCount: number; url: string; downloadUrl: string}};
export type ProjectSummary = {id: string; title: string; updatedAt: string; revision: number};
export class EditorAPI {
  base: string; token = ''; abort = new AbortController();
  constructor(base = '') {this.base = base.replace(/\/$/, '');}
  url(path: string) {return this.base + path;}
  async get<T = any>(path: string): Promise<T> {return this.request(path);}
  async post<T = any>(path: string, body: unknown = {}): Promise<T> {
    const init = {method: 'POST', headers: {'Content-Type': 'application/json', 'x-editor-token': this.token}, body: JSON.stringify(body)};
    try {return await this.request(path, init);} catch (error) {
      // A retry keeps the identical request ID and payload. Non-idempotent operations are never replayed here.
      if ((body as any)?.requestId && error instanceof TypeError && !this.abort.signal.aborted) return await this.request(path, init);
      throw error;
    }
  }
  async upload(file: File): Promise<Asset> {
    return this.request('/api/assets', {method: 'POST', headers: {'x-filename': encodeURIComponent(file.name), 'x-editor-token': this.token}, body: file});
  }
  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(this.url(path), {...init, signal: this.abort.signal});
    const json = await response.json(); if (!response.ok) throw Error(json.error || 'REQUEST_FAILED'); return json;
  }
  dispose() {this.abort.abort();}
}
export function explainError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error), code = raw.split(':')[0];
  const translations: Record<string, string> = {
    TRACK_LOCKED: '请先解锁轨道。', OVERLAP_POLICY_UNRESOLVED: '此位置与同轨片段重叠，请移到空白处或另一条轨道。',
    SOURCE_RANGE_EXCEEDED: '裁切区间超出了素材长度。', INVALID_TIME: '请输入有效的时间区间。', INVALID_SPEED: '请输入大于零的速度。',
    REVISION_CONFLICT: '工程已在其他窗口更新，请重新打开工程后继续。', SOURCE_DRAFT_READ_ONLY: '此剪映草稿包含尚未支持的内容，目前以只读方式打开。',
    UNSUPPORTED_DRAFT_EFFECTS: '草稿中仍有未支持的效果，暂时不能导出。', TIMING_NOT_INTERPRETED: '此片段的变速或关键帧尚未支持。',
    SPLIT_OUTSIDE_CLIP: '请将播放头放在所选片段内部再分割。', EMPTY_TIMELINE: '请先添加素材到时间线。', MEDIA_NOT_LINKED: '工程引用的素材尚未重新链接，请重新导入对应素材。',
    TRACK_KIND_MISMATCH: '素材类型与目标轨道不匹配。', BODY_TOO_LARGE: '工程文件太大。', UPLOAD_TOO_LARGE: '单个素材暂时不能超过512MB。',
    INVALID_TEXT: '文字不能为空，且最多2000个字符。', NO_MEDIA_STREAM: '未能在此文件中读取视频、声音或图片。',
    TEXT_FLIP_UNSUPPORTED: '当前还不支持文字翻转，请先关闭该属性。',
    JOB_CANCELLED: '任务已取消。', INVALID_SESSION_TOKEN: '服务已重新启动，请刷新编辑器。', INVALID_TRANSFORM: '位置、缩放或透明度超出允许范围。',
    SOURCE_PROJECT_REQUIRES_DRAFT_IMPORT: '这份工程含尚未解析的剪映内容，请通过“导入剪映草稿”打开原始草稿。'
  };
  if (translations[code]) return translations[code];
  if (/Failed to fetch|fetch failed|NetworkError/i.test(raw)) return '无法连接本地编辑服务，请确认服务正在运行。';
  if (/MEDIA_PROCESS/.test(raw)) return '媒体处理失败，请检查源文件和导出任务详情。';
  return '操作未完成：' + raw.slice(0, 160);
}
