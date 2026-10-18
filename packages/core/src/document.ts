import {rational, compare, add, mul, ZERO} from './time.ts';
import type {Rational} from './time.ts';

export type Range = {start: Rational; duration: Rational};
export type Asset = {id: string; path: string; duration: Rational};
export type Clip = {
  id: string; materialId: string; source: Range; target: Range;
  speed: Rational; editableTiming: boolean;
};
export type Track = {id: string; kind: 'video'; clips: Clip[]};
export type Document = {
  schemaVersion: 1; canvas: {width: number; height: number};
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
  check(doc.assets.length <= 10000 && doc.tracks.length <= 500, 'DOCUMENT_LIMIT');
  check(doc.canvas && [doc.canvas.width, doc.canvas.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 16384), 'INVALID_CANVAS');
  validRational(doc.fps, 'fps'); check(compare(doc.fps, ZERO) > 0 && compare(doc.fps, rational(1000)) <= 0, 'INVALID_FPS');
  const assets = new Map<string, Asset>(), tracks = new Set<string>(), clips = new Set<string>();
  const id = (s: unknown) => typeof s === 'string' && s.length > 0 && s.length <= 200;
  for (const a of doc.assets) {
    check(a && id(a.id) && typeof a.path === 'string', 'INVALID_MATERIAL');
    check(!assets.has(a.id), 'DUPLICATE_ID', a.id);
    validRational(a.duration, a.id); check(compare(a.duration, ZERO) > 0, 'INVALID_TIME', a.id);
    assets.set(a.id, a);
  }
  for (const t of doc.tracks) {
    check(t && id(t.id) && t.kind === 'video' && Array.isArray(t.clips) && t.clips.length <= 10000, 'UNSUPPORTED_CORE_STRUCTURE');
    check(!tracks.has(t.id), 'DUPLICATE_ID', t.id); tracks.add(t.id);
    for (const c of t.clips) {
      check(c && id(c.id) && typeof c.editableTiming === 'boolean', 'INVALID_CLIP');
      check(!clips.has(c.id), 'DUPLICATE_ID', c.id); clips.add(c.id);
      const asset = assets.get(c.materialId); check(asset, 'MISSING_MATERIAL', c.id);
      for (const r of [c.source, c.target]) {
        check(r, 'INVALID_TIME', c.id); validRational(r.start, c.id); validRational(r.duration, c.id);
        check(compare(r.start, ZERO) >= 0 && compare(r.duration, ZERO) > 0, 'INVALID_TIME', c.id);
      }
      validRational(c.speed, c.id); check(compare(c.speed, ZERO) > 0, 'INVALID_SPEED', c.id);
      check(compare(mul(c.target.duration, c.speed), c.source.duration) === 0, 'UNSUPPORTED_TIME_MAPPING', c.id);
      check(compare(add(c.source.start, c.source.duration), asset.duration) <= 0, 'SOURCE_RANGE_EXCEEDED', c.id);
    }
  }
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
