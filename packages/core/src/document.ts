import {rational, compare, add, mul, ZERO} from './time.ts';
import type {Rational} from './time.ts';

export type Range = {start: Rational; duration: Rational};
export type Asset = {
  id: string; path: string; duration: Rational; kind?: 'video' | 'audio' | 'image' | 'text';
  name?: string; width?: number; height?: number; hasAudio?: boolean; fps?: Rational;
  sha256?: string; mime?: string;
};
export type Transform = {x: number; y: number; scale: number; rotation: number; opacity: number; flipX: boolean; flipY: boolean};
export type TextStyle = {content: string; size: number; color: string; font: string};
export type Clip = {
  id: string; materialId: string; source: Range; target: Range;
  speed: Rational; editableTiming: boolean; transform?: Transform; volume?: number; muted?: boolean; text?: TextStyle;
};
export type Track = {id: string; kind: 'video' | 'audio' | 'text'; clips: Clip[]; name?: string; locked?: boolean; hidden?: boolean; muted?: boolean};
export type Document = {
  schemaVersion: 1; title?: string; canvas: {width: number; height: number};
  fps: Rational; assets: Asset[]; tracks: Track[];
};
export type Diagnostic = {code: string; trackId?: string; clipId?: string};
export type Imported = {document: Document; provenance: {raw: unknown; sha256: string}; diagnostics: Diagnostic[]};

export function check(ok: unknown, code: string, field = ''): asserts ok {
  if (!ok) throw Error(`${code}${field ? ': ' + field : ''}`);
}
export function validRational(value: unknown, field = ''): asserts value is Rational {
  check(value && typeof value === 'object', 'INVALID_TIME', field);
  const v = value as Rational;
  check(typeof v.numerator === 'string' && typeof v.denominator === 'string', 'INVALID_TIME', field);
  let normalized: Rational;
  try { normalized = rational(v.numerator, v.denominator); } catch { throw Error(`INVALID_TIME: ${field}`); }
  check(normalized.numerator === v.numerator && normalized.denominator === v.denominator, 'INVALID_TIME', field);
}
export function validateDocument(doc: Document): void {
  check(doc && doc.schemaVersion === 1 && Array.isArray(doc.assets) && Array.isArray(doc.tracks), 'INVALID_JSON_STRUCTURE');
  check(doc.title === undefined || typeof doc.title === 'string' && doc.title.length <= 200, 'INVALID_TITLE');
  check(doc.assets.length <= 10000 && doc.tracks.length <= 500, 'DOCUMENT_LIMIT');
  check(doc.canvas && [doc.canvas.width, doc.canvas.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384), 'INVALID_CANVAS');
  validRational(doc.fps, 'fps'); check(compare(doc.fps, ZERO) > 0 && compare(doc.fps, rational(1000)) <= 0, 'INVALID_FPS');
  const assets = new Map<string, Asset>(), tracks = new Set<string>(), clips = new Set<string>();
  const id = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 200;
  for (const a of doc.assets) {
    check(a && id(a.id) && typeof a.path === 'string', 'INVALID_MATERIAL');
    check(!assets.has(a.id), 'DUPLICATE_ID', a.id);
    validRational(a.duration, a.id); check(compare(a.duration, ZERO) > 0, 'INVALID_TIME', a.id);
    check(a.kind === undefined || ['video', 'audio', 'image', 'text'].includes(a.kind), 'INVALID_MATERIAL_KIND');
    for (const n of [a.width, a.height]) check(n === undefined || Number.isSafeInteger(n) && n > 0 && n <= 65536, 'INVALID_MEDIA_SIZE');
    check(a.hasAudio === undefined || typeof a.hasAudio === 'boolean', 'INVALID_MEDIA_AUDIO');
    if (a.fps !== undefined) {validRational(a.fps); check(compare(a.fps, ZERO) > 0, 'INVALID_FPS');}
    check(a.sha256 === undefined || /^[a-f0-9]{64}$/.test(a.sha256), 'INVALID_MEDIA_HASH');
    check(a.name === undefined || typeof a.name === 'string' && a.name.length <= 1000, 'INVALID_MEDIA_NAME');
    assets.set(a.id, a);
  }
  for (const t of doc.tracks) {
    check(t && id(t.id) && ['video', 'audio', 'text'].includes(t.kind) && Array.isArray(t.clips) && t.clips.length <= 10000, 'UNSUPPORTED_CORE_STRUCTURE');
    for (const key of ['locked', 'hidden', 'muted'] as const) check(t[key] === undefined || typeof t[key] === 'boolean', 'INVALID_TRACK_SWITCH');
    check(!tracks.has(t.id), 'DUPLICATE_ID', t.id); tracks.add(t.id);
    for (const c of t.clips) {
      check(c && id(c.id) && typeof c.editableTiming === 'boolean', 'INVALID_CLIP');
      check(!clips.has(c.id), 'DUPLICATE_ID', c.id); clips.add(c.id);
      const asset = assets.get(c.materialId); check(asset, 'MISSING_MATERIAL', c.id);
      const kind = asset.kind || 'video';
      check(t.kind === 'video' ? ['video', 'image'].includes(kind) : t.kind === kind, 'TRACK_KIND_MISMATCH');
      for (const r of [c.source, c.target]) {
        check(r, 'INVALID_TIME', c.id); validRational(r.start, c.id); validRational(r.duration, c.id);
        check(compare(r.start, ZERO) >= 0 && compare(r.duration, ZERO) > 0, 'INVALID_TIME', c.id);
      }
      validRational(c.speed, c.id); check(compare(c.speed, ZERO) > 0, 'INVALID_SPEED', c.id);
      check(compare(mul(c.target.duration, c.speed), c.source.duration) === 0, 'UNSUPPORTED_TIME_MAPPING', c.id);
      check(compare(add(c.source.start, c.source.duration), asset.duration) <= 0, 'SOURCE_RANGE_EXCEEDED', c.id);
      check(c.volume === undefined || Number.isFinite(c.volume) && c.volume >= 0 && c.volume <= 4, 'INVALID_VOLUME');
      check(c.muted === undefined || typeof c.muted === 'boolean', 'INVALID_MUTE');
      if (c.transform !== undefined) {
        const v = c.transform;
        check(v && [v.x, v.y, v.scale, v.rotation, v.opacity].every(Number.isFinite), 'INVALID_TRANSFORM');
        check(Math.abs(v.x) <= 65536 && Math.abs(v.y) <= 65536 && v.scale >= 0.01 && v.scale <= 10 && Math.abs(v.rotation) <= 3600 && v.opacity >= 0 && v.opacity <= 1, 'INVALID_TRANSFORM');
        check(typeof v.flipX === 'boolean' && typeof v.flipY === 'boolean', 'INVALID_TRANSFORM');
      }
      if (kind === 'text') {
        check(c.text && typeof c.text.content === 'string' && c.text.content.length > 0 && c.text.content.length <= 2000, 'INVALID_TEXT');
        check(Number.isFinite(c.text.size) && c.text.size >= 8 && c.text.size <= 500 && /^#[0-9a-f]{6}$/i.test(c.text.color), 'INVALID_TEXT_STYLE');
        check(typeof c.text.font === 'string' && c.text.font.length <= 100 && !/[\r\n,{}\\]/.test(c.text.font), 'INVALID_FONT');
      }
    }
  }
}
export const defaultTransform = (): Transform => ({x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false});
export function emptyDocument(): Document {
  return {schemaVersion: 1, title: '未命名工程', canvas: {width: 1920, height: 1080}, fps: rational(30), assets: [],
    tracks: [{id: 'video-main', kind: 'video', name: '主轨道', clips: []}, {id: 'audio-main', kind: 'audio', name: '音频', clips: []}, {id: 'text-main', kind: 'text', name: '文字', clips: []}]};
}
export function projectTiming(doc: Document): unknown[] {
  validateDocument(doc);
  return doc.tracks.map(t => ({kind: t.kind, clips: t.clips.map(c => ({source: c.source, target: c.target, speed: c.speed}))}));
}
export function duration(doc: Document): Rational {
  return doc.tracks.flatMap(t => t.clips).reduce((end, c) => {
    const next = add(c.target.start, c.target.duration); return compare(next, end) > 0 ? next : end;
  }, ZERO);
}
