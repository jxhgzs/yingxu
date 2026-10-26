import type {Crop} from './crop.ts';
import type {Vignette} from './vignette.ts';
import {check, validateDocument, duration, defaultTransform} from './document.ts';
import type {Asset, Clip, Document, Track, Transform, TextStyle} from './document.ts';
import {add, compare, div, sub, ZERO, rational} from './time.ts';
import type {Rational} from './time.ts';
import {trimAnimations,animationBounds} from './animation.ts';
import type {Keyframe,AnimatedProperty} from './animation.ts';
import {clampAudioFade} from './audio-fade.ts';
import type {AudioFade} from './audio-fade.ts';
import type {ColorAdjustments} from './color-effects.ts';
import type {TextAnimation} from './text-animation.ts';
import {curveTrimDuration,alignCurveTrimTime} from './curve-speed.ts';
import {assertNoClipTransitions} from './transitions.ts';

export type EditingCommand =
  | {type: 'asset.add'; asset: Asset}
  | {type: 'clip.add'; trackId: string; clip: Clip}
  | {type: 'clip.remove'; clipId: string; ripple: boolean}
  | {type: 'clip.move'; clipId: string; trackId: string; start: Rational}
  | {type: 'clip.trim'; clipId: string; sourceStart: Rational; sourceDuration: Rational; targetStart?: Rational;pushFollowing?:boolean}
  | {type: 'clip.update'; clipId: string; changes: {crop?:Crop|null;transform?: Transform; volume?: number; muted?: boolean; text?: TextStyle;audioFade?:AudioFade;colorAdjustments?:ColorAdjustments;vignette?:Vignette;textAnimations?:TextAnimation[]}}
  | {type:'keyframe.set';clipId:string;property:AnimatedProperty;point:Keyframe}
  | {type:'keyframe.remove';clipId:string;property:AnimatedProperty;pointId:string}
  | {type: 'track.add'; track: Track}
  | {type: 'track.update'; trackId: string; changes: {locked?: boolean; hidden?: boolean; muted?: boolean; name?: string}}
  | {type: 'project.settings'; title?: string; canvas?: {width: number; height: number}; fps?: Rational;mainTrackMagnet?:boolean};

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
export function applyEdit(doc: Document, command: EditingCommand,deferOverlap=false): Document {
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
    if(command.mainTrackMagnet!==undefined)next.mainTrackMagnet=command.mainTrackMagnet;
    if (command.fps !== undefined) next.fps = structuredClone(command.fps);
  } else if (command.type === 'clip.add') {
    const t = track(command.trackId); unlocked(t); t.clips.push(structuredClone(command.clip));
  } else {
    check(['clip.remove', 'clip.move', 'clip.trim', 'clip.update','keyframe.set','keyframe.remove'].includes(command.type), 'UNKNOWN_COMMAND');
    const t = next.tracks.find(t => t.clips.some(c => c.id === command.clipId)); check(t, 'CLIP_NOT_FOUND'); unlocked(t);
    const i = t.clips.findIndex(c => c.id === command.clipId), c = t.clips[i];
    check(c.editableTiming, 'TIMING_NOT_INTERPRETED');
    if(command.type==='clip.remove'||command.type==='clip.move'||command.type==='clip.trim')assertNoClipTransitions(doc,c.id);
    if (command.type === 'clip.remove') {
      check(typeof command.ripple === 'boolean', 'INVALID_RIPPLE'); t.clips.splice(i, 1);
      if (command.ripple) for (const later of t.clips) if (compare(later.target.start, add(c.target.start, c.target.duration)) >= 0) {
        check(later.editableTiming, 'TIMING_NOT_INTERPRETED'); later.target.start = sub(later.target.start, c.target.duration);
      }
    } else if (command.type === 'clip.move') {
      const target = track(command.trackId); unlocked(target); check(target.kind === t.kind, 'TRACK_KIND_MISMATCH');
      c.target.start = structuredClone(command.start); if (target !== t) {t.clips.splice(i, 1); target.clips.push(c);}
    } else if (command.type === 'clip.trim') {
      check(!c.textAnimations?.length,'TEXT_ANIMATION_TIMING_EDIT_UNVERIFIED');
      check(command.pushFollowing===undefined||typeof command.pushFollowing==='boolean','INVALID_TRIM_POLICY');
      check(!c.speedCurve||!c.animations?.length,'CURVE_ANIMATED_TRIM_UNVERIFIED');
      const oldSource=c.source;
      c.source = {start: structuredClone(command.sourceStart), duration: structuredClone(command.sourceDuration)};
      const oldStart=c.target.start;
      c.target.duration = c.speedCurve?curveTrimDuration(c.speedCurve,command.sourceDuration,next.fps):div(command.sourceDuration,c.speed);
      if(c.speedCurve)c.speed=div(c.source.duration,c.target.duration);
      if (command.targetStart !== undefined) c.target.start = structuredClone(command.targetStart);
      if(c.animations?.length){
        const startChanged=compare(oldSource.start,c.source.start)!==0,end=add(c.source.start,c.source.duration),endChanged=compare(add(oldSource.start,oldSource.duration),end)!==0;
        const filtered=trimAnimations(c.animations,c.source.start,end,startChanged&&!endChanged?'left':endChanged&&!startChanged?'right':undefined);
        c.animations=filtered.animations;
        for(const [property,value] of Object.entries(filtered.staticValues)){
          if(property==='volume')c.volume=value;
          else{c.transform||=defaultTransform();c.transform[property as Exclude<AnimatedProperty,'volume'>]=value;}
        }
      }
      clampAudioFade(c);
      if(c.speedCurve&&command.pushFollowing){
        let end=add(c.target.start,c.target.duration);
        for(const later of t.clips.filter(other=>other.id!==c.id&&compare(other.target.start,oldStart)>=0).sort((a,b)=>compare(a.target.start,b.target.start))){
          check(later.editableTiming,'TIMING_NOT_INTERPRETED');
          assertNoClipTransitions(doc,later.id);
          const start=compare(later.target.start,end)>0?later.target.start:end;
          const alignedStart=alignCurveTrimTime(start,next.fps),alignedEnd=alignCurveTrimTime(add(start,later.target.duration),next.fps);
          later.target.start=alignedStart;later.target.duration=sub(alignedEnd,alignedStart);later.speed=div(later.source.duration,later.target.duration);end=alignedEnd;
        }
      }
    } else if (command.type === 'clip.update') {
      check(command.changes && Object.keys(command.changes).every(k => ['crop','transform', 'volume', 'muted', 'text','audioFade','colorAdjustments','vignette','textAnimations'].includes(k)), 'INVALID_CLIP_UPDATE');
      Object.assign(c, structuredClone(command.changes));if(command.changes.crop===null)delete c.crop;
    } else if(command.type==='keyframe.set'){
      check(Object.hasOwn(animationBounds,command.property),'INVALID_ANIMATION_PROPERTY');
      check(compare(command.point.time,c.source.start)>=0&&compare(command.point.time,add(c.source.start,c.source.duration))<=0,'KEYFRAME_OUTSIDE_CLIP');
      c.animations||=[];let animation=c.animations.find(a=>a.property===command.property);
      if(!animation){animation={property:command.property,points:[]};c.animations.push(animation);}
      animation.points=animation.points.filter(p=>p.id!==command.point.id&&compare(p.time,command.point.time)!==0);
      animation.points.push(structuredClone(command.point));animation.points.sort((a,b)=>compare(a.time,b.time));
    } else if(command.type==='keyframe.remove'){
      const animation=c.animations?.find(a=>a.property===command.property),point=animation?.points.find(p=>p.id===command.pointId);
      check(animation&&point,'KEYFRAME_NOT_FOUND');
      animation.points=animation.points.filter(p=>p.id!==command.pointId);
      if(!animation.points.length){
        c.animations=c.animations!.filter(a=>a!==animation);
        if(command.property==='volume')c.volume=point.value;
        else{c.transform||=defaultTransform();c.transform[command.property]=point.value;}
      }
    }
  }
  validateDocument(next); if(!deferOverlap)assertNoVideoOverlap(next); return next;
}
