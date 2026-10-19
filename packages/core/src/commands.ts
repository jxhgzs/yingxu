import {check, validateDocument, validRational} from './document.ts';
import type {Document,Asset} from './document.ts';
import {rational, add, sub, mul, div, compare, ZERO} from './time.ts';
import type {Rational} from './time.ts';
import {applyEdit, assertNoVideoOverlap} from './edits.ts';
import type {EditingCommand} from './edits.ts';
import {sliceAnimations} from './animation.ts';
import {parseSubtitles} from './subtitles.ts';
import {applySubtitleImport} from './subtitle-import.ts';
import type {SubtitleImportOptions} from './subtitle-import.ts';
import {applyAssetRelink} from './relink.ts';
import {curveDuration,splitSpeedCurve} from './curve-speed.ts';
import type {SpeedCurve} from './curve-speed.ts';

export type AtomicCommand =
  | {type: 'split'; clipId: string; at: Rational; rightId: string}
  | {type: 'speed'; clipId: string; value: Rational; shiftFollowing: boolean}
  | {type:'subtitles.import';input:string;format:'srt'|'vtt';options:SubtitleImportOptions}
  | {type:'asset.relink';assetId:string;replacement:Asset}
  | {type:'speed.curve';clipId:string;curve:SpeedCurve|null;shiftFollowing:boolean}
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
  if(command.type==='subtitles.import'){
    const next=applySubtitleImport(doc,parseSubtitles(command.input,command.format),command.options).document;
    if(!deferOverlap)assertNoVideoOverlap(next);return next;
  }
  if(command.type==='asset.relink'){
    const next=applyAssetRelink(doc,command);if(!deferOverlap)assertNoVideoOverlap(next);return next;
  }
  if (command.type !== 'split' && command.type !== 'speed'&&command.type!=='speed.curve') return applyEdit(doc, command,deferOverlap);
  const next = structuredClone(doc);
  const track = next.tracks.find(t => t.clips.some(c => c.id === command.clipId)); check(track, 'CLIP_NOT_FOUND');
  const index = track.clips.findIndex(c => c.id === command.clipId), clip = track.clips[index];
  check(!track.locked, 'TRACK_LOCKED', track.id);
  check(clip.editableTiming, 'TIMING_NOT_INTERPRETED', clip.id);
  if (command.type === 'split') {
    validRational(command.at, 'split.at');
    check(typeof command.rightId === 'string' && command.rightId.length > 0, 'INVALID_CLIP_ID');
    check(!next.tracks.some(t => t.clips.some(c => c.id === command.rightId)), 'DUPLICATE_ID');
    let leftTarget = sub(command.at, clip.target.start),splitAt=command.at;
    check(compare(leftTarget, ZERO) > 0 && compare(leftTarget, clip.target.duration) < 0, 'SPLIT_OUTSIDE_CLIP');
    let leftSource = mul(leftTarget, clip.speed);
    const dividedCurve=clip.speedCurve?splitSpeedCurve(clip.speedCurve,clip.source.duration,clip.target.duration,leftTarget,next.fps):undefined;
    if(dividedCurve){leftTarget=dividedCurve.targetDelta;leftSource=dividedCurve.sourceDelta;splitAt=add(clip.target.start,leftTarget);}
    const right = structuredClone(clip); right.id = command.rightId;
    right.source = {start: add(clip.source.start, leftSource), duration: sub(clip.source.duration, leftSource)};
    right.target = {start: splitAt, duration: sub(clip.target.duration, leftTarget)};
    clip.source.duration = leftSource; clip.target.duration = leftTarget;
    if(dividedCurve){clip.speedCurve=dividedCurve.left;right.speedCurve=dividedCurve.right;clip.speed=div(clip.source.duration,clip.target.duration);right.speed=div(right.source.duration,right.target.duration);}
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
    clip.speed = command.value; clip.target.duration = newDuration;delete clip.speedCurve;
    if (command.shiftFollowing) for (const other of track.clips) {
      if (other.id !== clip.id && compare(other.target.start, oldEnd) >= 0) {
        check(other.editableTiming, 'TIMING_NOT_INTERPRETED', other.id);
        other.target.start = add(other.target.start, delta);
      }
    }
  } else if(command.type==='speed.curve'){
    check(typeof command.shiftFollowing==='boolean','INVALID_SPEED');
    check(command.curve===null||command.curve&&typeof command.curve==='object','INVALID_CURVE_SPEED');
    const oldEnd=add(clip.target.start,clip.target.duration),newDuration=command.curve?curveDuration(command.curve,clip.source.duration,next.fps):clip.source.duration;
    const delta=sub(newDuration,clip.target.duration);
    clip.target.duration=structuredClone(newDuration);clip.speed=div(clip.source.duration,newDuration);
    if(command.curve)clip.speedCurve=structuredClone(command.curve);else delete clip.speedCurve;
    if(command.shiftFollowing)for(const other of track.clips)if(other.id!==clip.id&&compare(other.target.start,oldEnd)>=0){check(other.editableTiming,'TIMING_NOT_INTERPRETED',other.id);other.target.start=add(other.target.start,delta);}
  } else throw Error('UNKNOWN_COMMAND');
  validateDocument(next);
  if(!deferOverlap)assertNoVideoOverlap(next);
  return next;
}
