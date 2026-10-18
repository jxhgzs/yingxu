import {createHash} from 'node:crypto';
import {check, validateDocument} from '../../core/src/document.ts';
import type {Document, Diagnostic, Imported} from '../../core/src/document.ts';
import {decimal, micros} from '../../core/src/time.ts';

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
  const doc: Document = {
    schemaVersion: 1, canvas: {width: canvas.width, height: canvas.height}, fps: decimal(String(number(input.fps, 'fps'))),
    assets: videos.map((v: unknown) => {
      const a = object(v, 'material'); return {id: a.id, path: a.path, duration: time(a.duration, 'material.duration')};
    }),
    tracks: array(input.tracks, 'tracks').map((v: unknown) => {
      const t = object(v, 'track'); check(t.type === 'video', 'UNSUPPORTED_CORE_STRUCTURE', String(t.id));
      return {id: t.id, kind: 'video', clips: array(t.segments, 'segments').map((v: unknown) => {
        const s = object(v, 'segment');
        let editableTiming = true;
        if (s.common_keyframes != null) {
          check(Array.isArray(s.common_keyframes), 'INVALID_JSON_STRUCTURE', 'common_keyframes');
          if (s.common_keyframes.length) {
            editableTiming = false; diagnostics.push({code: 'KEYFRAME_CLOCK_UNRESOLVED', clipId: s.id});
          }
        }
        const refs = new Set(s.extra_material_refs || []);
        const speeds = materials.speeds || [];
        check(Array.isArray(speeds), 'INVALID_JSON_STRUCTURE', 'materials.speeds');
        for (const speed of speeds) if (refs.has(speed.id) && speed.curve_speed != null) {
          editableTiming = false; diagnostics.push({code: 'CURVE_SPEED_UNSUPPORTED', clipId: s.id});
        }
        diagnostics.push({code: 'VISUAL_SEMANTICS_NOT_INTERPRETED', trackId: t.id, clipId: s.id});
        return {id: s.id, materialId: s.material_id, source: range(s.source_timerange, 'source_timerange'),
          target: range(s.target_timerange, 'target_timerange'), speed: decimal(String(number(s.speed, 'speed'))), editableTiming};
      })};
    })
  };
  validateDocument(doc);
  if (sourceText !== undefined) check(JSON.stringify(JSON.parse(sourceText)) === JSON.stringify(raw), 'SOURCE_TEXT_MISMATCH');
  return {document: doc, provenance: {raw: structuredClone(raw), sha256: createHash('sha256').update(sourceText ?? JSON.stringify(raw)).digest('hex')}, diagnostics};
}
