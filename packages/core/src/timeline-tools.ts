import {check,defaultTransform,validateDocument} from './document.ts';import type {Document,Clip,Asset} from './document.ts';
import {applyCommand} from './commands.ts';import type {Command,AtomicCommand} from './commands.ts';
import {add,sub,compare,rational,frameTime,nearestFrame,ZERO} from './time.ts';import type {Rational} from './time.ts';
import {sourceTimeAt,evaluateAnimation,sliceAnimations} from './animation.ts';import type {Marker} from './markers.ts';import {assertNoClipTransitions} from './transitions.ts';
export type ToolCommand={type:'clip.replace';clipId:string;clip:Clip}|{type:'marker.set';clipId?:string;marker:Marker}|{type:'marker.remove';clipId?:string;markerId:string};
export function selectedClip(doc:Document,id:string){const track=doc.tracks.find(t=>t.clips.some(c=>c.id===id));check(track,'CLIP_NOT_FOUND');const clip=track.clips.find(c=>c.id===id)!;return {track,clip,asset:doc.assets.find(a=>a.id===clip.materialId)!};}
export function applyToolCommand(doc:Document,command:ToolCommand):Document{
 const next=structuredClone(doc);let clip:Clip|undefined;
 if(command.type==='clip.replace'||command.clipId){const found=selectedClip(next,command.clipId!);check(!found.track.locked,'TRACK_LOCKED');check(found.clip.editableTiming,'TIMING_NOT_INTERPRETED');clip=found.clip;}
 if(command.type==='clip.replace'){
  assertNoClipTransitions(doc,command.clipId);check(command.clip?.id===command.clipId,'INVALID_CLIP_ID');const found=selectedClip(next,command.clipId);found.track.clips[found.track.clips.indexOf(found.clip)]=structuredClone(command.clip);
 }else{
  const owner=clip||next;owner.markers||=[];
  if(command.type==='marker.set'){check(command.marker&&typeof command.marker==='object','INVALID_MARKER');owner.markers=owner.markers.filter(m=>m.id!==command.marker.id);owner.markers.push(structuredClone(command.marker));}
  else {check(owner.markers.some(m=>m.id===command.markerId),'MARKER_NOT_FOUND');owner.markers=owner.markers.filter(m=>m.id!==command.markerId);}
 }
 validateDocument(next);return next;
}
export function quickCutCommand(doc:Document,clipId:string,at:Rational,side:'left'|'right'):Command{
 const {track,clip}=selectedClip(doc,clipId);let rightId='cut';while(doc.tracks.some(t=>t.clips.some(c=>c.id===rightId)))rightId+='x';
 const split=applyCommand(doc,{type:'split',clipId,at,rightId});const halves=split.tracks.find(t=>t.id===track.id)!.clips;
 const left=halves.find(c=>c.id===clipId)!,right=halves.find(c=>c.id===rightId)!,keep=structuredClone(side==='left'?right:left);keep.id=clipId;
 const removed=side==='left'?left.target.duration:right.target.duration,magnetic=track===doc.tracks.find(t=>t.kind==='video')&&doc.mainTrackMagnet!==false;
 if(side==='left'&&magnetic)keep.target.start=clip.target.start;
 const commands:AtomicCommand[]=[{type:'clip.replace',clipId,clip:keep}],oldEnd=add(clip.target.start,clip.target.duration);
 if(magnetic)for(const later of track.clips)if(later.id!==clipId&&compare(later.target.start,oldEnd)>=0)commands.push({type:'clip.move',clipId:later.id,trackId:track.id,start:sub(later.target.start,removed)});
 return {type:'batch',commands};
}
export function freezeCommand(doc:Document,clipId:string,at:Rational,image:Asset,stillId:string,rightId:string):Command{
 const {clip,track}=selectedClip(doc,clipId);check(!track.locked,'TRACK_LOCKED');assertNoClipTransitions(doc,clipId);check(compare(at,clip.target.start)>=0&&compare(at,add(clip.target.start,clip.target.duration))<0,'FREEZE_OUTSIDE_CLIP');
 const length=frameTime(nearestFrame(rational(3),doc.fps).numerator,doc.fps),source=sourceTimeAt(clip,at),transform={...defaultTransform(),...clip.transform};
 for(const animation of clip.animations||[])if(animation.property!=='volume')transform[animation.property]=evaluateAnimation(animation,source);
 const still:Clip={id:stillId,materialId:image.id,source:{start:ZERO,duration:length},target:{start:at,duration:length},speed:rational(1),editableTiming:true,transform,...(clip.crop?{crop:structuredClone(clip.crop)}:{}),...(clip.colorAdjustments?{colorAdjustments:structuredClone(clip.colorAdjustments)}:{}),...(clip.vignette?{vignette:structuredClone(clip.vignette)}:{})};
 const commands:AtomicCommand[]=[];let view=doc;
 if(compare(at,clip.target.start)>0){const split:AtomicCommand={type:'split',clipId,at,rightId};view=applyCommand(doc,split);commands.push(split);}
 for(const later of view.tracks.find(t=>t.id===track.id)!.clips)if(compare(later.target.start,at)>=0)commands.push({type:'clip.move',clipId:later.id,trackId:track.id,start:add(later.target.start,length)});
 if(!doc.assets.some(a=>a.id===image.id))commands.push({type:'asset.add',asset:image});commands.push({type:'clip.add',trackId:track.id,clip:still});return {type:'batch',commands};
}
export function reverseReplacement(clip:Clip,asset:Asset):Clip{
 const next=structuredClone(clip);next.materialId=asset.id;next.source.start=ZERO;
 if(next.animations?.length)next.animations=sliceAnimations(clip.animations!,clip.source.start,add(clip.source.start,clip.source.duration)).map(a=>({...a,points:a.points.map(p=>({...p,time:sub(p.time,clip.source.start)}))}));
 if(next.markers)next.markers=next.markers.filter(m=>compare(m.time,clip.source.start)>=0&&compare(m.time,add(clip.source.start,clip.source.duration))<=0).map(m=>({...m,time:sub(clip.source.duration,sub(m.time,clip.source.start))}));
 return next;
}
