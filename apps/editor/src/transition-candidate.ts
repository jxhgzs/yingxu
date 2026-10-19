import type {Document,Transition} from '../../../packages/core/src/document.ts';
import {validateDocument} from '../../../packages/core/src/document.ts';
import {add,sub,mul,div,compare,rational,decimal,toNumber,ZERO} from '../../../packages/core/src/time.ts';
import {transitionUsesSourceHandles} from '../../../packages/core/src/transitions.ts';
import type {Rational} from '../../../packages/core/src/time.ts';

export type TransitionCandidate={transition?:Transition;name?:string;reason?:string};
const minimum=(...values:Rational[])=>values.reduce((a,b)=>compare(a,b)<=0?a:b);

/** UI suggestions never grant eligibility: each candidate must pass the complete core validator. */
export function buildTransitionCandidate(doc:Document|undefined,trackId:string|undefined,clipId:string|undefined,kind:Transition['kind']):TransitionCandidate{
 const track=doc?.tracks.find(t=>t.id===trackId),clip=track?.clips.find(c=>c.id===clipId);
 if(!doc||!track||!clip||track.kind!=='video')return {reason:'请选择视频片段。'};
 const ordered=[...track.clips].sort((a,b)=>compare(a.target.start,b.target.start)),index=ordered.findIndex(c=>c.id===clip.id),next=ordered[index+1];
 if(!next||compare(add(clip.target.start,clip.target.duration),next.target.start)!==0)return {reason:'所选片段后方需要紧邻另一段视频。'};
 if(doc.transitions?.some(t=>t.outgoingClipId===clip.id))return {reason:'此剪辑点已有转场。'};
 try{
  const preferred=minimum(rational(1,2),div(clip.target.duration,rational(2)),div(next.target.duration,rational(2))),durations=[preferred];
  if(transitionUsesSourceHandles(kind)){
   // At CFR30 a centred window must begin/end on whole frames: half a second is 7.5 frames per side.
   // Try an even-frame window, but retain core policy checks for confirmation, timing and all bounds.
   if(compare(doc.fps,rational(30))===0){const pairs=mul(preferred,rational(15));durations.push(rational(BigInt(pairs.numerator)/BigInt(pairs.denominator),15));}
   const asset=doc.assets.find(a=>a.id===clip.materialId);
   if(asset){
    const sourceEnd=add(clip.source.start,mul(clip.target.duration,clip.speed));
    durations.push(minimum(preferred,div(mul(sub(asset.duration,sourceEnd),rational(2)),clip.speed),div(mul(next.source.start,rational(2)),next.speed)));
   }
  }
  const ids=new Set(doc.transitions?.map(t=>t.id)||[]);let id='transition-candidate',suffix=0;while(ids.has(id))id=`transition-candidate-${++suffix}`;
  let missingHandles=false;
  for(const duration of durations){
   if(compare(duration,ZERO)<=0||compare(duration,div(rational(1),doc.fps))<0)continue;
   const transition:Transition={id,trackId:track.id,outgoingClipId:clip.id,incomingClipId:next.id,kind,alignment:'center',overlap:transitionUsesSourceHandles(kind),duration};
   try{validateDocument({...doc,transitions:[...(doc.transitions||[]),transition]});return {transition,name:doc.assets.find(a=>a.id===next.materialId)?.name||'下一片段'};}
   catch(error){if(error instanceof Error&&error.message.startsWith('TRANSITION_SOURCE_HANDLES_MISSING'))missingHandles=true;}
  }
  return {reason:missingHandles?'转场两侧需要保留足够的源素材，请先调整采用区间。':'此剪辑点暂不支持添加转场，请检查变速、素材和已有转场。'};
 }catch{return {reason:'此剪辑点暂不支持添加转场，请检查变速、素材和已有转场。'};}
}

/** The six-decimal inspector display must not rewrite an unchanged exact frame duration. */
export function transitionDurationFromInput(transition:Transition,value:number):Rational{
 const exact=toNumber(transition.duration);
 return Number.isFinite(value)&&value.toFixed(6)===exact.toFixed(6)?transition.duration:decimal(String(value));
}
