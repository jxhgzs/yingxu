import {check,defaultTransform,validRational,validateDocument} from './document.ts';import type {Document} from './document.ts';
import {applyCommand} from './commands.ts';import type {Command} from './commands.ts';import {assertNoVideoOverlap} from './edits.ts';
import {selectedClip,quickCutCommand,freezeCommand,reverseReplacement} from './timeline-tools.ts';
import {add,compare,rational,toNumber} from './time.ts';import type {Rational} from './time.ts';
import {validateMarkers} from './markers.ts';
import {sourceTimeAt,evaluateAnimation,keyframeAtFrame} from './animation.ts';import {assertNoClipTransitions} from './transitions.ts';
export type TimelineTool='split'|'cutLeft'|'cutRight'|'delete'|'marker'|'freeze'|'reverse'|'mirror'|'rotate'|'crop';
export type MediaToolProof={reason:string;fileReason?:string;frames?:number};
export function validateMediaTool(document:Document,kind:'freeze'|'reverse',operation:{clipId:string;at?:Rational}){
 check(typeof operation.clipId==='string'&&operation.clipId.length>0,'INVALID_CLIP_ID');if(kind==='freeze')validRational(operation.at,'freeze.at');
 const {track,clip,asset}=selectedClip(document,operation.clipId);check(!track.locked,'TRACK_LOCKED');check(clip.editableTiming,'TIMING_NOT_INTERPRETED');
 check((asset.kind||'video')==='video'&&asset.verifiedDisplayTransform!=='unsupported','MEDIA_OPERATION_UNSUPPORTED');assertNoClipTransitions(document,clip.id);
 check(asset.fps&&asset.width&&asset.height,'REVERSE_MEDIA_UNSUPPORTED');
 if(kind==='freeze'){check(operation.at&&compare(operation.at,clip.target.start)>=0&&compare(operation.at,add(clip.target.start,clip.target.duration))<0,'FREEZE_OUTSIDE_CLIP');check(!clip.textAnimations?.length,'TEXT_ANIMATION_TIMING_EDIT_UNVERIFIED');}
 else{check(toNumber(clip.source.duration)<=3600&&toNumber(asset.fps)<=120,'REVERSE_MEDIA_LIMIT');check(asset.width*asset.height*4<=128*1024*1024,'REVERSE_FRAME_TOO_LARGE');check(compare(sourceTimeAt(clip,add(clip.target.start,clip.target.duration)),add(clip.source.start,clip.source.duration))<=0,'REVERSE_CURVE_RANGE_UNSUPPORTED');}
 return {track,clip,asset};
}
const attempt=(fn:()=>unknown)=>{try{fn();return '';}catch(e){return e instanceof Error?e.message:String(e);}};
/** Dry-run the same immutable commands; never writes history, assets or media. */
export function timelineToolReasons(doc:Document|undefined,clipId:string|null,at:Rational,proof:MediaToolProof={reason:'MEDIA_TOOL_CHECKING'},blocked=''){
 const keys:TimelineTool[]=['split','cutLeft','cutRight','delete','marker','freeze','reverse','mirror','rotate','crop'];
 const result=Object.fromEntries(keys.map(k=>[k,blocked||(!doc?'TOOL_NO_PROJECT':'')])) as Record<TimelineTool,string>;
 if(blocked||!doc)return result;
 const chosen=clipId?doc.tracks.flatMap(track=>track.clips.map(clip=>({track,clip}))).find(x=>x.clip.id===clipId):undefined;
 const selectionReason=!chosen?'TOOL_SELECT_CLIP':chosen.track.locked?'TRACK_LOCKED':!chosen.clip.editableTiming?'TIMING_NOT_INTERPRETED':'';
 const used=new Set([...doc.assets.map(a=>a.id),...doc.tracks.flatMap(t=>t.clips.map(c=>c.id))]);let next=0;const id=()=>{let s;do{s='toolbar-check-'+next++;}while(used.has(s));used.add(s);return s;};
 const inside=!!chosen&&compare(at,chosen.clip.target.start)>=0&&compare(at,add(chosen.clip.target.start,chosen.clip.target.duration))<0;
 result.marker=markerReason(doc,chosen,at,selectionReason);
 for(const key of keys.filter(k=>k!=='marker'))result[key]=selectionReason;
 if(selectionReason)return result;
 const {clip}=chosen!,asset=doc.assets.find(a=>a.id===clip.materialId)!;
 result.split=attempt(()=>applyCommand(doc,{type:'split',clipId:clip.id,at,rightId:id()}));
 result.cutLeft=attempt(()=>checkGeneratedBatch(doc,quickCutCommand(doc,clip.id,at,'left')));result.cutRight=attempt(()=>checkGeneratedBatch(doc,quickCutCommand(doc,clip.id,at,'right')));
 result.delete=attempt(()=>applyCommand(doc,{type:'clip.remove',clipId:clip.id,ripple:false}));
 const visual=['video','image'].includes(asset.kind||'video')?'':'TOOL_SELECT_VISUAL';
 result.mirror=visual||attempt(()=>applyCommand(doc,{type:'clip.update',clipId:clip.id,changes:{transform:{...defaultTransform(),...clip.transform,flipX:!clip.transform?.flipX}}}));
 const rotation=clip.animations?.find(a=>a.property==='rotation');
 result.rotate=visual||attempt(()=>{if(rotation){const point=keyframeAtFrame(clip,'rotation',at,doc.fps),source=point?.time||sourceTimeAt(clip,at);check(inside,'TOOL_ANIMATED_ROTATION_OUTSIDE');return applyCommand(doc,{type:'keyframe.set',clipId:clip.id,property:'rotation',point:{id:point?.id||id(),time:source,value:(evaluateAnimation(rotation,source)+90)%360,interpolation:point?.interpolation||'linear'}});}return applyCommand(doc,{type:'clip.update',clipId:clip.id,changes:{transform:{...defaultTransform(),...clip.transform,rotation:((clip.transform?.rotation||0)+90)%360}}});});
 result.crop=visual||(asset.verifiedDisplayTransform==='unsupported'?'MEDIA_OPERATION_UNSUPPORTED':!asset.width||!asset.height||asset.width<2||asset.height<2?'TOOL_CROP_SIZE':'')||(proof.fileReason??proof.reason);
 for(const kind of ['freeze','reverse'] as const)result[kind]=attempt(()=>{validateMediaTool(doc,kind,{clipId:clip.id,at});if(proof.reason)throw Error(proof.reason);const derived={...asset,id:id(),path:'toolbar-check',kind:kind==='freeze'?'image' as const:'video' as const,duration:kind==='freeze'?rational(3600):clip.source.duration};delete derived.frameTiming;if(kind==='freeze')delete derived.pixelFormat;if(kind==='freeze'){check(proof.frames!==undefined&&Math.floor(toNumber(sourceTimeAt(clip,at))*toNumber(asset.fps!)+1e-7)<proof.frames,'FREEZE_OUTSIDE_CLIP');return checkGeneratedBatch(doc,freezeCommand(doc,clip.id,at,derived,id(),id()));}check(proof.frames!==undefined&&Math.ceil(toNumber(add(clip.source.start,clip.source.duration))*toNumber(asset.fps!)-1e-7)<=proof.frames,'MEDIA_OPERATION_FRAME_TIMING');return applyCommand(doc,{type:'batch',commands:[{type:'asset.add',asset:derived},{type:'clip.replace',clipId:clip.id,clip:reverseReplacement(clip,derived)}]});});
 return result;
}

function markerReason(doc:Document,chosen:{track:Document['tracks'][number];clip:Document['tracks'][number]['clips'][number]}|undefined,at:Rational,selectionReason:string){
 const inside=!!chosen&&compare(at,chosen.clip.target.start)>=0&&compare(at,add(chosen.clip.target.start,chosen.clip.target.duration))<0;
 const owner=inside?chosen!.clip:doc,time=inside?sourceTimeAt(chosen!.clip,at):at;
 if(inside&&selectionReason)return selectionReason;
 if(owner.markers?.some(m=>compare(m.time,time)===0))return 'TOOL_MARKER_EXISTS';
 let id='toolbar-check-marker';while(owner.markers?.some(m=>m.id===id))id+='x';
 return attempt(()=>validateMarkers([...(owner.markers||[]),{id,time,title:'标记',color:'#00c1cd'}],inside?doc.assets.find(a=>a.id===chosen!.clip.materialId)!.duration:rational(3600)));
}
/** Vue documents are immutable. Cache ordinary timing regions, never media or per-frame pixels. */
export function createTimelineToolResolver(){
 let current:Document|undefined;const cache=new Map<string,Record<TimelineTool,string>>();
 return (doc:Document|undefined,clipId:string|null,at:Rational,proof:MediaToolProof={reason:'MEDIA_TOOL_CHECKING'},blocked='')=>{
  if(doc!==current){cache.clear();current=doc;}
  if(!doc||blocked)return timelineToolReasons(doc,clipId,at,proof,blocked);
  const chosen=clipId?doc.tracks.flatMap(track=>track.clips.map(clip=>({track,clip}))).find(x=>x.clip.id===clipId):undefined;
  const clip=chosen?.clip,start=clip?compare(at,clip.target.start):0,end=clip?compare(at,add(clip.target.start,clip.target.duration)):0;
  const region=!clip?'none':clip.speedCurve||clip.animations?.some(a=>a.property==='rotation')?JSON.stringify(at):start<0?'before':start===0?'start':end<0?'inside':end===0?'end':'after';
  const key=JSON.stringify([clipId,region,proof]);let value=cache.get(key);
  if(!value){value=timelineToolReasons(doc,clipId,at,proof);if(cache.size>=32)cache.delete(cache.keys().next().value!);cache.set(key,value);}
  const selectedReason=!chosen?'TOOL_SELECT_CLIP':chosen.track.locked?'TRACK_LOCKED':!chosen.clip.editableTiming?'TIMING_NOT_INTERPRETED':'';
  const result={...value,marker:markerReason(doc,chosen,at,selectedReason)};
  if(!result.freeze&&clip&&proof.frames!==undefined){const asset=doc.assets.find(a=>a.id===clip.materialId)!;if(Math.floor(toNumber(sourceTimeAt(clip,at))*toNumber(asset.fps!)+1e-7)>=proof.frames)result.freeze='FREEZE_OUTSIDE_CLIP';}
  return result;
 };
}

/** Builders above emit only these atomic steps. Validate moved-clip guards and one final document,
 * instead of cloning/validating every unchanged track for every downstream move on each head update. */
function checkGeneratedBatch(doc:Document,command:Command){
 if(command.type!=='batch')return applyCommand(doc,command);
 check(command.commands.length>0&&command.commands.length<=100,'INVALID_COMMAND_BATCH');let next=structuredClone(doc);
 for(const step of command.commands){
  if(step.type==='split'){next=applyCommand(next,step);continue;}
  if(step.type==='clip.move'){const {clip,track}=selectedClip(next,step.clipId);check(!track.locked,'TRACK_LOCKED');check(clip.editableTiming,'TIMING_NOT_INTERPRETED');assertNoClipTransitions(doc,clip.id);check(track.id===step.trackId,'TRACK_KIND_MISMATCH');clip.target.start=structuredClone(step.start);}
  else if(step.type==='clip.replace'){const {clip,track}=selectedClip(next,step.clipId);check(!track.locked,'TRACK_LOCKED');check(clip.editableTiming,'TIMING_NOT_INTERPRETED');assertNoClipTransitions(doc,clip.id);check(step.clip.id===clip.id,'INVALID_CLIP_ID');track.clips[track.clips.indexOf(clip)]=structuredClone(step.clip);}
  else if(step.type==='asset.add'){check(!next.assets.some(a=>a.id===step.asset.id),'DUPLICATE_ID');next.assets.push(structuredClone(step.asset));}
  else if(step.type==='clip.add'){const track=next.tracks.find(t=>t.id===step.trackId);check(track,'TRACK_NOT_FOUND');check(!track.locked,'TRACK_LOCKED');track.clips.push(structuredClone(step.clip));}
  else return applyCommand(doc,command);
 }
 validateDocument(next);assertNoVideoOverlap(next);return next;
}
