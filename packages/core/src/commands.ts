import {check, validateDocument, validRational} from './document.ts';
import type {Document} from './document.ts';
import {rational, add, sub, mul, div, compare, ZERO} from './time.ts';
import type {Rational} from './time.ts';

export type Command =
  | {type: 'split'; clipId: string; at: Rational; rightId: string}
  | {type: 'speed'; clipId: string; value: Rational; shiftFollowing: boolean};

export function applyCommand(doc: Document, command: Command): Document {
  validateDocument(doc); check(command && typeof command === 'object', 'INVALID_COMMAND');
  const next = structuredClone(doc);
  const track = next.tracks.find(t => t.clips.some(c => c.id === command.clipId)); check(track, 'CLIP_NOT_FOUND');
  const index = track.clips.findIndex(c => c.id === command.clipId), clip = track.clips[index];
  check(clip.editableTiming, 'TIMING_NOT_INTERPRETED', clip.id);
  if (command.type === 'split') {
    validRational(command.at, 'split.at');
    check(typeof command.rightId === 'string' && command.rightId.length > 0, 'INVALID_CLIP_ID');
    check(!next.tracks.some(t => t.clips.some(c => c.id === command.rightId)), 'DUPLICATE_ID');
    const leftTarget = sub(command.at, clip.target.start);
    check(compare(leftTarget, ZERO) > 0 && compare(leftTarget, clip.target.duration) < 0, 'SPLIT_OUTSIDE_CLIP');
    const leftSource = mul(leftTarget, clip.speed);
    const right = structuredClone(clip); right.id = command.rightId;
    right.source = {start: add(clip.source.start, leftSource), duration: sub(clip.source.duration, leftSource)};
    right.target = {start: command.at, duration: sub(clip.target.duration, leftTarget)};
    clip.source.duration = leftSource; clip.target.duration = leftTarget;
    track.clips.splice(index + 1, 0, right);
  } else if (command.type === 'speed') {
    validRational(command.value, 'speed');
    check(compare(command.value, ZERO) > 0 && typeof command.shiftFollowing === 'boolean', 'INVALID_SPEED');
    const oldEnd = add(clip.target.start, clip.target.duration), newDuration = div(clip.source.duration, command.value);
    const delta = sub(newDuration, clip.target.duration);
    clip.speed = command.value; clip.target.duration = newDuration;
    if (command.shiftFollowing) for (const other of track.clips) {
      if (other.id !== clip.id && compare(other.target.start, oldEnd) >= 0) {
        check(other.editableTiming, 'TIMING_NOT_INTERPRETED', other.id);
        other.target.start = add(other.target.start, delta);
      }
    }
  } else throw Error('UNKNOWN_COMMAND');
  validateDocument(next);
  for (const t of next.tracks) {
    let end = rational(0);
    for (const c of [...t.clips].sort((a, b) => compare(a.target.start, b.target.start))) {
      check(compare(c.target.start, end) >= 0, 'OVERLAP_POLICY_UNRESOLVED', c.id);
      end = add(c.target.start, c.target.duration);
    }
  }
  return next;
}
