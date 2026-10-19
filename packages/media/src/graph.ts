import {check, validateDocument, defaultTransform, duration} from '../../core/src/document.ts';
import type {Document, Asset, Clip} from '../../core/src/document.ts';
import {compare, mul, rational, toNumber, ZERO} from '../../core/src/time.ts';

export type Layer = {clip: Clip; asset: Asset};
export type RenderGraph = {version: 1; document: Document; layers: Layer[]; audio: Layer[]; frameCount: number; duration: number};

export function renderGraph(input: Document): RenderGraph {
  validateDocument(input); const doc = structuredClone(input);
  const end = duration(doc); check(compare(end, ZERO) > 0, 'EMPTY_TIMELINE');
  check(toNumber(end) <= 3600 && doc.tracks.flatMap(t => t.clips).length <= 300, 'RENDER_LIMIT');
  const frames = mul(end, doc.fps), n = BigInt(frames.numerator), d = BigInt(frames.denominator);
  const frameCount = Number((n + d - 1n) / d);
  const layers: Layer[] = [], audio: Layer[] = [];
  for (const t of doc.tracks) for (const clip of t.clips) {
    const asset = doc.assets.find(a => a.id === clip.materialId)!;
    check(clip.editableTiming, 'TIMING_NOT_INTERPRETED', clip.id);
    check(asset.kind !== 'text' || !clip.transform?.flipX && !clip.transform?.flipY, 'TEXT_FLIP_UNSUPPORTED', clip.id);
    check(asset.kind !== 'text' || compare(doc.fps,rational(100))<=0, 'TEXT_RENDER_FPS_LIMIT', clip.id);
    check(compare(clip.speed, rational(1, 16)) >= 0 && compare(clip.speed, rational(16)) <= 0, 'RENDER_SPEED_LIMIT');
    if (!t.hidden && t.kind !== 'audio') layers.push({asset, clip: {...clip, transform: clip.transform || defaultTransform()}});
    if (!t.muted && !clip.muted && (clip.volume !== 0 || clip.animations?.some(a=>a.property==='volume')) && (asset.hasAudio || asset.kind === 'audio')) audio.push({asset, clip});
  }
  return {version: 1, document: doc, layers, audio, frameCount, duration: frameCount / toNumber(doc.fps)};
}
