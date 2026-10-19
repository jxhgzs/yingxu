import {createHash} from 'node:crypto';
import {check, validateDocument} from '../../core/src/document.ts';
import type {Document, Diagnostic, Imported} from '../../core/src/document.ts';
import {decimal, micros,div} from '../../core/src/time.ts';
import {importAudioFade} from './audio-fade.ts';
import {importScaleAnimations} from './animation.ts';
import {importKnownVideoVisual} from './visual.ts';
import {importKnownSpeedCurve} from './curve.ts';
import {importNativeTransitions} from './transitions.ts';
import {importColorAdjustments} from './color-effects.ts';

function object(v: unknown, field: string): Record<string, any> {
  check(v && typeof v === 'object' && !Array.isArray(v), 'INVALID_JSON_STRUCTURE', field);
  return v as Record<string, any>;
}
function array(v: unknown, field: string): any[] {
  check(Array.isArray(v), 'INVALID_JSON_STRUCTURE', field); return v;
}
function number(v: unknown, field: string): number {
  check(typeof v === 'number' && Number.isFinite(v), 'INVALID_TIME', field); return v;
}
function time(v: unknown, field: string) {
  const n = number(v, field); check(Number.isSafeInteger(n), 'INVALID_TIME', field); return micros(n);
}
function range(v: unknown, field: string) {
  const r = object(v, field); return {start: time(r.start, field), duration: time(r.duration, field)};
}
export function importJianying(raw: unknown, sourceText?: string): Imported {
  const input = object(raw, 'root'), materials = object(input.materials, 'materials'), canvas = object(input.canvas_config, 'canvas_config');
  const videos = array(materials.videos, 'materials.videos');
  const diagnostics: Diagnostic[] = [];
  const rawAssetById = new Map(videos.map(v=>{const a=object(v,'material');return [a.id,a];}));
  const assets = videos.map((v: unknown) => {
    const a = object(v, 'material'); return {id: a.id, path: a.path, duration: time(a.duration, 'material.duration'),kind:'video' as const,
      ...(a.material_name!==undefined?{name:a.material_name}:{}),...(a.width!==undefined?{width:a.width}:{}),
      ...(a.height!==undefined?{height:a.height}:{}),...(a.has_audio!==undefined?{hasAudio:a.has_audio}:{})};
  });
  const assetById = new Map(assets.map(a=>[a.id,a]));
  const doc: Document = {
    schemaVersion: 1, canvas: {width: canvas.width, height: canvas.height}, fps: decimal(String(number(input.fps, 'fps'))),
    assets,
    tracks: array(input.tracks, 'tracks').map((v: unknown) => {
      const t = object(v, 'track'); check(t.type === 'video', 'UNSUPPORTED_CORE_STRUCTURE', String(t.id));
      return {id: t.id, kind: 'video', clips: array(t.segments, 'segments').map((v: unknown) => {
        const s = object(v, 'segment');
        let editableTiming = true;
        const asset = assetById.get(s.material_id); check(asset, 'MISSING_MATERIAL', s.id);
        const animation = importScaleAnimations(s, asset.duration);
        if (animation.diagnostic) {
          editableTiming = false; diagnostics.push({code: animation.diagnostic, clipId: s.id});
        }
        const refs = new Set(s.extra_material_refs || []);
        const speeds = materials.speeds || [];
        check(Array.isArray(speeds), 'INVALID_JSON_STRUCTURE', 'materials.speeds');
        const curve=importKnownSpeedCurve(s,materials),hasCurve=speeds.some((speed:any)=>speed&&refs.has(speed.id)&&speed.curve_speed!=null);
        if(curve.diagnostic){editableTiming=false;diagnostics.push({code:curve.diagnostic,clipId:s.id});}
        const fade=importAudioFade(s,materials);if(fade.diagnostic)diagnostics.push({code:fade.diagnostic,clipId:s.id});
        const color=importColorAdjustments(s,materials);if(color.diagnostic)diagnostics.push({code:color.diagnostic,clipId:s.id});
        const visual=importKnownVideoVisual(s,rawAssetById.get(s.material_id)!,materials,!!curve.curve,!!fade.fade);
        if(!visual)diagnostics.push({code: 'VISUAL_SEMANTICS_NOT_INTERPRETED', trackId: t.id, clipId: s.id});
        const source=range(s.source_timerange,'source_timerange'),target=range(s.target_timerange,'target_timerange');
        const nativeSpeed=decimal(String(number(s.speed,'speed')));
        return {id:s.id,materialId:s.material_id,source,target,speed:hasCurve?div(source.duration,target.duration):nativeSpeed,editableTiming,
          ...(curve.curve?{speedCurve:curve.curve}:{}),...(animation.animations ? {animations:animation.animations} : {}),...(visual||{}),...(color.colorAdjustments?{colorAdjustments:color.colorAdjustments}:{}),...(fade.fade?{audioFade:fade.fade}:{})};
      })};
    })
  };
  validateDocument(doc);
  const transitions=importNativeTransitions(input,doc);
  if(transitions.transitions.length)doc.transitions=transitions.transitions;
  diagnostics.push(...transitions.diagnostics);
  for(const track of doc.tracks)for(const clip of track.clips)if(transitions.blockedClipIds.has(clip.id))clip.editableTiming=false;
  validateDocument(doc);
  if (sourceText !== undefined) check(JSON.stringify(JSON.parse(sourceText)) === JSON.stringify(raw), 'SOURCE_TEXT_MISMATCH');
  return {document: doc, provenance: {raw: structuredClone(raw), sha256: createHash('sha256').update(sourceText ?? JSON.stringify(raw)).digest('hex')}, diagnostics};
}
