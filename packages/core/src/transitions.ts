import {check, validRational} from './document.ts';
import type {Asset,Clip, Document, Range, Transition} from './document.ts';
import {add, sub, mul, div, compare, rational, ZERO} from './time.ts';
import type {Rational} from './time.ts';
export type {Transition} from './document.ts';

export function isSpatialTransition(kind:Transition['kind']):boolean{return kind==='wipeLeft'||kind==='circleOpen';}
export function transitionUsesSourceHandles(kind:Transition['kind']):boolean{return kind==='crossfade'||isSpatialTransition(kind);}

/** Sequence time and source time stay exact; decoder frame selection is a separate boundary. */
export function transitionWindow(transition:Transition,outgoing:Clip):Range {
  validRational(transition.duration,'transition.duration');
  check(compare(transition.duration,ZERO)>0,'INVALID_TRANSITION_DURATION',transition.id);
  return {start:sub(add(outgoing.target.start,outgoing.target.duration),div(transition.duration,rational(2))),duration:transition.duration};
}

/** Includes source handles outside the clip's declared range; never clamps them. */
export function transitionSourceAt(clip:Clip,targetTime:Rational):Rational {
  check(clip.editableTiming&&!clip.speedCurve,'TRANSITION_TIME_MAPPING_UNSUPPORTED',clip.id);
  validRational(targetTime,'transition.time');
  return add(clip.source.start,mul(sub(targetTime,clip.target.start),clip.speed));
}

export function transitionHandles(transition:Transition,outgoing:Clip,incoming:Clip):{
  window:Range;outgoingSourceEnd:Rational;incomingSourceStart:Rational;
} {
  const window=transitionWindow(transition,outgoing);
  return {window,outgoingSourceEnd:transitionSourceAt(outgoing,add(window.start,window.duration)),incomingSourceStart:transitionSourceAt(incoming,window.start)};
}

/** Only the individually observed CFR30 / 1x / aligned source boundary is admitted. */
export function transitionBoundaryPolicy(fps:Rational,transition:Transition,outgoing:Clip,incoming:Clip,outAsset:Asset,inAsset:Asset):'handles'|'clone-cfr30'{
 const handles=transitionHandles(transition,outgoing,incoming);
 if(compare(handles.outgoingSourceEnd,outAsset.duration)<=0&&compare(handles.incomingSourceStart,ZERO)>=0)return 'handles';
 const aligned=(time:Rational)=>mul(time,rational(30)).denominator==='1';
 const confirmed=compare(fps,rational(30))===0&&[outgoing,incoming].every(clip=>!clip.speedCurve&&compare(clip.speed,rational(1))===0&&[clip.source.start,clip.source.duration,clip.target.start,clip.target.duration].every(aligned))&&[outAsset,inAsset].every(asset=>asset.frameTiming==='cfr30'&&!!asset.fps&&compare(asset.fps,rational(30))===0&&compare(asset.duration,rational(300))<=0&&aligned(asset.duration))&&[handles.window.start,handles.window.duration].every(aligned);
 check(confirmed,'TRANSITION_SOURCE_HANDLES_MISSING',transition.id);return 'clone-cfr30';
}

/** Sampling is clamped; source-clock property interpolation still uses the original clock. */
export function transitionDecodedSourceTime(asset:Asset,time:Rational):Rational{
 if(asset.frameTiming!=='cfr30')return time;
 if(compare(time,ZERO)<0)return ZERO;
 const last=sub(asset.duration,rational(1,30));return compare(time,last)>0?(compare(last,ZERO)<0?ZERO:last):time;
}

export function assertNoClipTransitions(doc:Document,clipId:string):void {
  check(!doc.transitions?.some(t=>t.outgoingClipId===clipId||t.incomingClipId===clipId),'TRANSITION_EDIT_REQUIRES_REMOVAL',clipId);
}

/** Used by document validation, including graph and renderer entry points. */
export function validateTransitions(doc:Document):void {
  if(doc.transitions===undefined)return;
  check(Array.isArray(doc.transitions)&&doc.transitions.length<=10000,'INVALID_TRANSITIONS');
  const ids=new Set<string>(),pairs=new Set<string>();
  const assets=new Map(doc.assets.map(a=>[a.id,a])),tracks=new Map(doc.tracks.map(t=>[t.id,t]));
  const orderedTracks=new Map<string,{clips:Clip[];indices:Map<string,number>}>();
  const windows=new Map<string,{id:string;range:Range}[]>();
  for(const transition of doc.transitions){
    const id=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200;
    check(transition&&id(transition.id)&&id(transition.trackId)&&id(transition.outgoingClipId)&&id(transition.incomingClipId),'INVALID_TRANSITION');
    check(Object.keys(transition).every(key=>['id','trackId','outgoingClipId','incomingClipId','kind','alignment','overlap','duration'].includes(key)),'UNSUPPORTED_TRANSITION_FIELD',transition.id);
    check(!ids.has(transition.id),'DUPLICATE_TRANSITION_ID',transition.id);ids.add(transition.id);
    check(['crossfade','dipToBlack','dipToWhite','wipeLeft','circleOpen'].includes(transition.kind),'TRANSITION_KIND_UNVERIFIED',transition.id);
    check(transition.alignment==='center'&&transition.overlap===transitionUsesSourceHandles(transition.kind),'TRANSITION_ALIGNMENT_UNSUPPORTED',transition.id);
    const track=tracks.get(transition.trackId);check(track&&track.kind==='video','TRANSITION_TRACK_UNSUPPORTED',transition.id);
    let ordered=orderedTracks.get(track.id);
    if(!ordered){const clips=[...track.clips].sort((a,b)=>compare(a.target.start,b.target.start));ordered={clips,indices:new Map(clips.map((c,i)=>[c.id,i]))};orderedTracks.set(track.id,ordered);}
    const index=ordered.indices.get(transition.outgoingClipId)??-1,outgoing=ordered.clips[index],incoming=ordered.clips[index+1];
    check(outgoing&&incoming&&incoming.id===transition.incomingClipId,'TRANSITION_PAIR_NOT_ADJACENT',transition.id);
    check(compare(add(outgoing.target.start,outgoing.target.duration),incoming.target.start)===0,'TRANSITION_PAIR_NOT_ADJACENT',transition.id);
    const pair=JSON.stringify([outgoing.id,incoming.id]);check(!pairs.has(pair),'DUPLICATE_TRANSITION_PAIR',transition.id);pairs.add(pair);
    for(const clip of [outgoing,incoming]){
      check(clip.editableTiming&&!clip.speedCurve,'TRANSITION_TIME_MAPPING_UNSUPPORTED',clip.id);
      check((assets.get(clip.materialId)?.kind||'video')==='video','TRANSITION_MEDIA_UNSUPPORTED',clip.id);
    }
    if(isSpatialTransition(transition.kind))check(doc.canvas.width===1280&&doc.canvas.height===720&&compare(doc.fps,rational(30))===0&&[outgoing,incoming].every(c=>compare(c.speed,rational(1))===0),'SPATIAL_TRANSITION_GEOMETRY_UNVERIFIED',transition.id);
    validRational(transition.duration,'transition.duration');
    check(compare(transition.duration,ZERO)>0&&[outgoing,incoming].every(c=>compare(mul(transition.duration,rational(2)),c.target.duration)<=0),'INVALID_TRANSITION_DURATION',transition.id);
    // Product boundary: require a nonempty output frame window; native UI minimum is unverified.
    check(compare(transition.duration,div(rational(1),doc.fps))>=0,'TRANSITION_DURATION_BELOW_ONE_FRAME',transition.id);
    const handles=transitionHandles(transition,outgoing,incoming),outAsset=assets.get(outgoing.materialId)!;
    if(transitionUsesSourceHandles(transition.kind))transitionBoundaryPolicy(doc.fps,transition,outgoing,incoming,outAsset,assets.get(incoming.materialId)!);
    const ranges=windows.get(track.id)||[];ranges.push({id:transition.id,range:handles.window});windows.set(track.id,ranges);
  }
  for(const ranges of windows.values()){
    ranges.sort((a,b)=>compare(a.range.start,b.range.start));
    for(let i=1;i<ranges.length;i++)check(compare(ranges[i].range.start,add(ranges[i-1].range.start,ranges[i-1].range.duration))>=0,'TRANSITION_WINDOWS_OVERLAP',ranges[i].id);
  }
}

export type TransitionCommand =
  | {type:'transition.add';transition:Transition}
  | {type:'transition.update';transitionId:string;changes:{kind?:Transition['kind'];duration?:Rational}}
  | {type:'transition.remove';transitionId:string};

export function applyTransitionCommand(doc:Document,command:TransitionCommand):Document {
  const next=structuredClone(doc);
  if(command.type==='transition.add'){
    check(command.transition&&typeof command.transition==='object','INVALID_TRANSITION');
    const track=next.tracks.find(t=>t.id===command.transition.trackId);check(track,'TRACK_NOT_FOUND');check(!track.locked,'TRACK_LOCKED',track.id);
    (next.transitions||=[]).push(structuredClone(command.transition));
  }else{
    const index=next.transitions?.findIndex(t=>t.id===command.transitionId)??-1;
    check(index>=0,'TRANSITION_NOT_FOUND',command.transitionId);
    const transition=next.transitions![index],track=next.tracks.find(t=>t.id===transition.trackId)!;check(!track.locked,'TRACK_LOCKED',track.id);
    if(command.type==='transition.remove')next.transitions!.splice(index,1);
    else{
      check(command.changes&&typeof command.changes==='object'&&Object.keys(command.changes).every(k=>['kind','duration'].includes(k)),'INVALID_TRANSITION_UPDATE');
      Object.assign(transition,structuredClone(command.changes));if(command.changes.kind)transition.overlap=transitionUsesSourceHandles(command.changes.kind);
    }
  }
  validateTransitions(next);return next;
}
