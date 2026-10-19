import {check, validateDocument, validRational} from './document.ts';
import type {Document} from './document.ts';
import {rational, add, sub, mul, div, compare, ZERO} from './time.ts';
import type {Rational} from './time.ts';
import {applyEdit, assertNoVideoOverlap} from './edits.ts';
import type {EditingCommand} from './edits.ts';
import {sliceAnimations} from './animation.ts';

export type AtomicCommand =
  | {type: 'split'; clipId: string; at: Rational; rightId: string}
  | {type: 'speed'; clipId: string; value: Rational; shiftFollowing: boolean}
  | EditingCommand;
export type Command = AtomicCommand | {type:'batch';commands:AtomicCommand[]};

export function applyCommand(doc: Document, command: Command): Document {
  if(command?.type==='batch'){
    validateDocument(doc);
    check(Array.isArray(command.commands)&&command.commands.length>0&&command.commands.length<=100,'INVALID_COMMAND_BATCH');
    let next=doc;
    for(const c of command.commands){check(c&&typeof c==='object'&&(c as {type:string}).type!=='batch','INVALID_COMMAND_BATCH');next=applySingle(next,c,true);}
    validateDocument(next);assertNoVideoOverlap(next);return next;
  }
  return applySingle(doc,command,false);
}
function applySingle(doc:Document,command:AtomicCommand,deferOverlap:boolean):Document{
  validateDocument(doc); check(command && typeof command === 'object', 'INVALID_COMMAND');
  if (command.type !== 'split' && command.type !== 'speed') return applyEdit(doc, command,deferOverlap);
  const next = structuredClone(doc);
  const track = next.tracks.find(t => t.clips.some(c => c.id === command.clipId)); check(track, 'CLIP_NOT_FOUND');
  const index = track.clips.findIndex(c => c.id === command.clipId), clip = track.clips[index];
  check(!track.locked, 'TRACK_LOCKED', track.id);
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
    if(clip.animations?.length){
      right.animations=sliceAnimations(clip.animations,right.source.start,add(right.source.start,right.source.duration));
      clip.animations=sliceAnimations(clip.animations,clip.source.start,add(clip.source.start,clip.source.duration));
    }
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
  if(!deferOverlap)assertNoVideoOverlap(next);
  return next;
}
