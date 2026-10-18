import {check, validateDocument, duration, defaultTransform} from './document.ts';
import type {Asset, Clip, Document, Track, Transform, TextStyle} from './document.ts';
import {add, compare, div, sub, ZERO, rational} from './time.ts';
import type {Rational} from './time.ts';

export type EditingCommand =
  | {type: 'asset.add'; asset: Asset}
  | {type: 'clip.add'; trackId: string; clip: Clip}
  | {type: 'clip.remove'; clipId: string; ripple: boolean}
  | {type: 'clip.move'; clipId: string; trackId: string; start: Rational}
  | {type: 'clip.trim'; clipId: string; sourceStart: Rational; sourceDuration: Rational; targetStart?: Rational}
  | {type: 'clip.update'; clipId: string; changes: {transform?: Transform; volume?: number; muted?: boolean; text?: TextStyle}}
  | {type: 'track.add'; track: Track}
  | {type: 'track.update'; trackId: string; changes: {locked?: boolean; hidden?: boolean; muted?: boolean; name?: string}}
  | {type: 'project.settings'; title?: string; canvas?: {width: number; height: number}; fps?: Rational};

export function newTextClip(doc: Document, materialId: string, id: string, position: Rational): Clip {
  const end = duration(doc), preferred = rational(4);
  let start = position;
  if (compare(end, ZERO) > 0 && compare(start, end) >= 0) start = compare(end, preferred) > 0 ? sub(end, preferred) : ZERO;
  const remaining = sub(end, start);
  const length = compare(remaining, ZERO) > 0 && compare(remaining, preferred) < 0 ? remaining : preferred;
  return {id, materialId, source: {start: ZERO, duration: length}, target: {start, duration: length}, speed: rational(1), editableTiming: true,
    transform: {...defaultTransform(), y: Math.round(doc.canvas.height * .32)}, text: {content: '添加文字', size: Math.round(doc.canvas.height * .06), font: 'PingFang SC', color: '#ffffff'}};
}

export function assertNoVideoOverlap(doc: Document): void {
  for (const t of doc.tracks.filter(t => t.kind === 'video')) {
    let end = ZERO;
    for (const c of [...t.clips].sort((a, b) => compare(a.target.start, b.target.start))) {
      check(compare(c.target.start, end) >= 0, 'OVERLAP_POLICY_UNRESOLVED', c.id);
      end = add(c.target.start, c.target.duration);
    }
  }
}
export function applyEdit(doc: Document, command: EditingCommand): Document {
  const next = structuredClone(doc);
  const track = (id: string) => {const t = next.tracks.find(t => t.id === id); check(t, 'TRACK_NOT_FOUND'); return t;};
  const unlocked = (t: Track) => check(!t.locked, 'TRACK_LOCKED', t.id);
  if (command.type === 'asset.add') {
    check(!next.assets.some(a => a.id === command.asset.id), 'DUPLICATE_ID'); next.assets.push(structuredClone(command.asset));
  } else if (command.type === 'track.add') {
    check(command.track && Array.isArray(command.track.clips) && command.track.clips.length === 0, 'INVALID_NEW_TRACK');
    next.tracks.push(structuredClone(command.track));
  } else if (command.type === 'track.update') {
    const t = track(command.trackId);
    check(command.changes && Object.keys(command.changes).every(k => ['locked', 'hidden', 'muted', 'name'].includes(k)), 'INVALID_TRACK_UPDATE');
    if (command.changes.name !== undefined) check(typeof command.changes.name === 'string' && command.changes.name.length <= 100, 'INVALID_TRACK_NAME');
    Object.assign(t, command.changes);
  } else if (command.type === 'project.settings') {
    if (command.title !== undefined) {check(typeof command.title === 'string' && command.title.length <= 200, 'INVALID_TITLE'); next.title = command.title;}
    if (command.canvas !== undefined) next.canvas = structuredClone(command.canvas);
    if (command.fps !== undefined) next.fps = structuredClone(command.fps);
  } else if (command.type === 'clip.add') {
    const t = track(command.trackId); unlocked(t); t.clips.push(structuredClone(command.clip));
  } else {
    check(['clip.remove', 'clip.move', 'clip.trim', 'clip.update'].includes(command.type), 'UNKNOWN_COMMAND');
    const t = next.tracks.find(t => t.clips.some(c => c.id === command.clipId)); check(t, 'CLIP_NOT_FOUND'); unlocked(t);
    const i = t.clips.findIndex(c => c.id === command.clipId), c = t.clips[i];
    check(c.editableTiming, 'TIMING_NOT_INTERPRETED');
    if (command.type === 'clip.remove') {
      check(typeof command.ripple === 'boolean', 'INVALID_RIPPLE'); t.clips.splice(i, 1);
      if (command.ripple) for (const later of t.clips) if (compare(later.target.start, add(c.target.start, c.target.duration)) >= 0) {
        check(later.editableTiming, 'TIMING_NOT_INTERPRETED'); later.target.start = sub(later.target.start, c.target.duration);
      }
    } else if (command.type === 'clip.move') {
      const target = track(command.trackId); unlocked(target); check(target.kind === t.kind, 'TRACK_KIND_MISMATCH');
      c.target.start = structuredClone(command.start); if (target !== t) {t.clips.splice(i, 1); target.clips.push(c);}
    } else if (command.type === 'clip.trim') {
      c.source = {start: structuredClone(command.sourceStart), duration: structuredClone(command.sourceDuration)};
      c.target.duration = div(command.sourceDuration, c.speed);
      if (command.targetStart !== undefined) c.target.start = structuredClone(command.targetStart);
    } else if (command.type === 'clip.update') {
      check(command.changes && Object.keys(command.changes).every(k => ['transform', 'volume', 'muted', 'text'].includes(k)), 'INVALID_CLIP_UPDATE');
      Object.assign(c, structuredClone(command.changes));
    }
  }
  validateDocument(next); assertNoVideoOverlap(next); return next;
}
