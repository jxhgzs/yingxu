import type {Document, Asset, Diagnostic} from '../../../packages/core/src/document.ts';
export type ProjectState = {id: string; revision: number; document: Document; documentHash: string; updatedAt: string; canUndo: boolean; canRedo: boolean; diagnostics: Diagnostic[]};
export type JobView = {engine?:string;id: string; projectId: string; kind: 'preview' | 'export'; status: string; progress: number; documentRevision: number; createdAt: string; error?: string;
  result?: {width: number; height: number; duration: number; frameCount: number; url: string; downloadUrl: string;format?:string;extension?:string;mime?:string}};
export type ProjectSummary = {id: string; title: string; updatedAt: string; revision: number};
export class EditorAPI {
  base: string; token = '';engine=''; abort = new AbortController();
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
    UNSUPPORTED_VIDEO_COLOR_SPACE:'此素材的色彩格式暂不支持，请先转换为标准动态范围视频。',
    INVALID_COLOR_ADJUSTMENTS:'调节参数超出了有效范围。',
    COLOR_ADJUSTMENTS_MEDIA_UNSUPPORTED:'此素材类型暂不支持调节。',
    COLOR_EFFECT_LUT_CACHE_LIMIT:'本次导出的调节组合数量超过当前上限，请分段导出。',
    COLOR_EFFECT_LUT_CORRUPT:'调节缓存校验失败，请重新生成预览或导出。',
    COLOR_EFFECT_LUT_UNSAFE_FILE:'调节缓存无法安全读取，请重新生成预览或导出。',
    TRANSITION_EDIT_REQUIRES_REMOVAL:'请先删除关联转场，再调整片段时间。',
    TRANSITION_SOURCE_HANDLES_MISSING:'转场两侧的源素材余量不足；端帧延展仅支持已验证的30fps恒速素材，可重新导入素材后重试。',
    TRANSITION_SOURCE_FRAME_TIMING_UNVERIFIED:'素材未通过逐帧30fps验证，无法使用零余量转场；请为转场保留源素材余量。',
    INVALID_TRANSITION_DURATION:'转场时长不能超过任一侧片段时长的一半。',
    TRANSITION_DURATION_BELOW_ONE_FRAME:'转场时长至少需要一帧。',
    TRANSITION_PAIR_NOT_ADJACENT:'转场两侧需要是同轨紧邻的视频片段。',
    TRANSITION_WINDOWS_OVERLAP:'转场播放区间相互重叠，请缩短时长。',
    TRANSITION_KIND_UNVERIFIED:'此转场目前尚未支持。',
    SPATIAL_TRANSITION_GEOMETRY_UNVERIFIED:'向左擦除与圆形遮罩目前支持1280×720、30fps、原速工程。',
    SPATIAL_TRANSITION_OUTPUT_SIZE_UNVERIFIED:'此空间转场请按1280×720画布尺寸导出。',
    UNSUPPORTED_TRANSITION_FIELD:'转场包含尚未支持的属性，请保留来源工程另行处理。',
    TRANSITION_TIME_MAPPING_UNSUPPORTED:'曲线变速片段暂不支持此转场。',
    TRACK_LOCKED: '请先解锁轨道。', OVERLAP_POLICY_UNRESOLVED: '此位置与同轨片段重叠，请移到空白处或另一条轨道。',
    SOURCE_RANGE_EXCEEDED: '裁切区间超出了素材长度。', INVALID_TIME: '请输入有效的时间区间。', INVALID_SPEED: '请输入大于零的速度。',
    REVISION_CONFLICT: '工程已在其他窗口更新，请重新打开工程后继续。', SOURCE_DRAFT_READ_ONLY: '此剪映草稿包含尚未支持的内容，目前以只读方式打开。',
    UNSUPPORTED_DRAFT_EFFECTS: '草稿中仍有未支持的效果，暂时不能导出。', TIMING_NOT_INTERPRETED: '此片段的变速或关键帧尚未支持。',
    SPLIT_OUTSIDE_CLIP: '请将播放头放在所选片段内部再分割。', EMPTY_TIMELINE: '请先添加素材到时间线。', MEDIA_NOT_LINKED: '工程引用的素材尚未重新链接，请重新导入对应素材。',
    TRACK_KIND_MISMATCH: '素材类型与目标轨道不匹配。', BODY_TOO_LARGE: '工程文件太大。', UPLOAD_TOO_LARGE: '单个素材暂时不能超过512MB。',
    INVALID_TEXT: '文字不能为空，且最多2000个字符。', NO_MEDIA_STREAM: '未能在此文件中读取视频、声音或图片。',
    SPATIAL_TRANSITION_SOURCE_SIZE_MISMATCH:'素材尺寸已变化，请重新关联后再导出转场。',
    SPATIAL_TRANSITION_SOURCE_ORIENTATION_UNSUPPORTED:'此素材包含方向变换，暂不支持当前转场边缘处理。',
    INVALID_VIGNETTE:'暗角强度须在-50到50之间。',
    VIGNETTE_SOURCE_SIZE_REQUIRED:'素材尺寸尚未确定，请重新关联后再应用暗角。',
    VIGNETTE_SOURCE_SIZE_MISMATCH:'素材尺寸已变化，请重新关联后再导出。',
    VIGNETTE_SOURCE_ORIENTATION_UNSUPPORTED:'此素材包含方向变换，暂不支持暗角导出。',
    VIGNETTE_SOURCE_SIZE_LIMIT:'此素材超出暗角支持的尺寸，请先缩小素材。',
    TEXT_FLIP_UNSUPPORTED: '当前还不支持文字翻转，请先关闭该属性。',
    TEXT_ANIMATION_TIMING_EDIT_UNVERIFIED:'请先移除文字动画，再分割、裁切或变速。',
    TEXT_ANIMATION_GLYPHS_UNVERIFIED:'当前逐字动画暂不支持此字形组合；可改用渐显或移除动画。',
    TEXT_GLYPH_LAYOUT_REQUIRED:'逐字动画的字形布局尚未准备完成，请重新准备预览。',
    TEXT_GLYPH_LAYOUT_TEXT_UNSUPPORTED:'逐字晃动支持最多128个常用汉字、英文、空格和换行。',
    TEXT_GLYPH_LAYOUT_SIZE_LIMIT:'此逐字动画超出字形准备范围，请缩小画布或减少文字。',
    TEXT_GLYPH_LAYOUT_SHAPING_UNVERIFIED:'此文字或字号暂不支持精确逐字晃动，请调整字号或改用其他动画。',
    TEXT_ANIMATION_OVERLAP_UNVERIFIED:'入场与出场动画总时长不能超过片段。',
    INVALID_TEXT_ANIMATION_DURATION:'动画时长须大于零且不超过片段；循环周期至少0.1秒，且不超过入场与出场之间的可用时长。',
    TEXT_ANIMATION_KIND_UNVERIFIED:'此文字动画目前尚未支持。',
    JOB_CANCELLED: '任务已取消。', INVALID_SESSION_TOKEN: '服务已重新启动，请刷新编辑器。', INVALID_TRANSFORM: '位置、缩放或透明度超出允许范围。',
    SOURCE_PROJECT_REQUIRES_DRAFT_IMPORT: '这份工程含尚未解析的剪映内容，请通过“导入剪映草稿”打开原始草稿。',
    INVALID_AUDIO_FADE:'请输入不超过片段时长的有效淡入淡出时间。',
    AUDIO_FADE_OVERLAP_UNVERIFIED:'淡入与淡出合计超过片段时长，请缩短其中一项。',
    KEYFRAME_TRIM_DIRECTION_UNVERIFIED:'请一次只调整入点或出点，分别应用裁切。',
    KEYFRAME_TRIM_COLLISION_UNSUPPORTED:'裁切使多个关键帧重合，请先移开边界附近的关键帧。',
    CURVE_ANIMATED_TRIM_UNVERIFIED:'含属性关键帧的曲线片段暂不支持直接裁切，可先分割后删除多余片段。',
    CURVE_DURATION_EMPTY:'裁切后不足一帧，请保留更长区间。',
    INVALID_CURVE_SPEED:'曲线端点必须位于0和1，横坐标递增，速度为0.1至10倍。',
    CURVE_AUDIO_ENGINE_UNAVAILABLE:'曲线音频引擎不可用，请检查桌面安装的音频组件。',
    CURVE_AUDIO_ENGINE_FAILED:'曲线音频处理失败，请查看任务详情。',
    CURVE_AUDIO_ENGINE_WARNING:'曲线音频处理出现异常，已停止导出，请查看任务详情。',
    CURVE_AUDIO_LENGTH_MISMATCH:'曲线音频时长检查未通过，请查看任务详情。',
    CURVE_AUDIO_NONFINITE:'曲线音频采样检查未通过，已停止导出。',
    CURVE_SOURCE_COVERAGE_EXCEEDED:'曲线实际播放区间超出素材末尾，请缩短片段或调整速度曲线。',
    RELINK_KIND_MISMATCH:'所选素材类型与工程素材不一致。',
    SUBTITLE_LAYOUT_OVERFLOW:'重叠字幕超出画布，请减少重叠或调整字幕内容。',
    SUBTITLE_NEGATIVE_START:'字幕整体偏移后出现负时间，请调整偏移量。',FONT_UNAVAILABLE:'工程所需字体未能加载，请检查桌面安装的字体组件。'
  };
  if (translations[code]) return translations[code];
  if (/Failed to fetch|fetch failed|NetworkError/i.test(raw)) return '无法连接本地编辑服务，请确认服务正在运行。';
  if (/MEDIA_PROCESS/.test(raw)) return '媒体处理失败，请检查源文件和导出任务详情。';
  return '操作未完成：' + raw.slice(0, 160);
}
