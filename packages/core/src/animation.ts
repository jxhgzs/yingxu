import {add, sub, mul, div, compare, toNumber, nearestFrame, ZERO} from './time.ts';
import type {Rational} from './time.ts';
import {check, validRational} from './document.ts';
import type {Clip} from './document.ts';
import {curveSourceDelta,curveTargetDelta} from './curve-speed.ts';

export type AnimatedProperty = 'x'|'y'|'scale'|'rotation'|'opacity'|'volume';
export type Keyframe = {id:string; time:Rational; value:number; interpolation:'linear'|'hold'};
export type Animation = {property:AnimatedProperty; points:Keyframe[]};
export const animationBounds:Record<AnimatedProperty,[number,number]>={x:[-65536,65536],y:[-65536,65536],scale:[.01,10],rotation:[-3600,3600],opacity:[0,1],volume:[0,4]};

export function validateAnimations(animations:Animation[], sourceDuration:Rational):void{
  check(Array.isArray(animations)&&animations.length<=6,'INVALID_ANIMATION');
  const properties=new Set<string>();
  for(const a of animations){
    check(a&&Object.hasOwn(animationBounds,a.property)&&!properties.has(a.property),'INVALID_ANIMATION_PROPERTY');properties.add(a.property);
    check(Array.isArray(a.points)&&a.points.length>0&&a.points.length<=500,'INVALID_KEYFRAMES');
    const ids=new Set<string>();let previous:Rational|undefined;
    for(const p of a.points){
      check(p&&typeof p.id==='string'&&p.id.length>0&&p.id.length<=200&&!ids.has(p.id),'INVALID_KEYFRAME_ID');ids.add(p.id);
      validRational(p.time,'keyframe.time');
      check(compare(p.time,ZERO)>=0&&compare(p.time,sourceDuration)<=0&&(!previous||compare(p.time,previous)>0),'INVALID_KEYFRAME_TIME');previous=p.time;
      const [min,max]=animationBounds[a.property];
      check(Number.isFinite(p.value)&&p.value>=min&&p.value<=max&&['linear','hold'].includes(p.interpolation),'INVALID_KEYFRAME');
    }
  }
}
export function sourceTimeAt(clip:Clip, targetTime:Rational):Rational{
  if(clip.speedCurve){
    let delta=sub(targetTime,clip.target.start);if(compare(delta,ZERO)<0)delta=ZERO;if(compare(delta,clip.target.duration)>0)delta=clip.target.duration;
    return add(clip.source.start,curveSourceDelta(clip.speedCurve,clip.source.duration,clip.target.duration,delta));
  }
  return add(clip.source.start,mul(sub(targetTime,clip.target.start),clip.speed));
}
export function targetTimeAt(clip:Clip, sourceTime:Rational):Rational{
  if(clip.speedCurve){
    let delta=sub(sourceTime,clip.source.start);if(compare(delta,ZERO)<0)delta=ZERO;if(compare(delta,clip.source.duration)>0)delta=clip.source.duration;
    return add(clip.target.start,curveTargetDelta(clip.speedCurve,clip.source.duration,clip.target.duration,delta));
  }
  return add(clip.target.start,div(sub(sourceTime,clip.source.start),clip.speed));
}
/** UI hit testing only. Editing an existing off-grid source point retains its exact time. */
export function keyframeAtFrame(clip:Clip,property:AnimatedProperty,targetTime:Rational,fps:Rational):Keyframe|undefined{
  const frame=nearestFrame(targetTime,fps);
  return clip.animations?.find(a=>a.property===property)?.points
    .filter(p=>compare(nearestFrame(targetTimeAt(clip,p.time),fps),frame)===0)
    .sort((a,b)=>Math.abs(toNumber(sub(targetTimeAt(clip,a.time),targetTime)))-Math.abs(toNumber(sub(targetTimeAt(clip,b.time),targetTime))))[0];
}
export function evaluateAnimation(animation:Animation, sourceTime:Rational):number{
  const points=animation.points;
  if(compare(sourceTime,points[0].time)<=0)return points[0].value;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(compare(sourceTime,b.time)<0){
      if(a.interpolation==='hold')return a.value;
      return a.value+toNumber(div(sub(sourceTime,a.time),sub(b.time,a.time)))*(b.value-a.value);
    }
  }
  return points.at(-1)!.value;
}
export function sliceAnimations(animations:Animation[],start:Rational,end:Rational):Animation[]{
  return animations.map(animation=>{
    const points=animation.points.filter(p=>compare(p.time,start)>=0&&compare(p.time,end)<=0).map(p=>structuredClone(p));
    const boundary=(time:Rational):Keyframe=>({id:`boundary:${animation.property}:${time.numerator}/${time.denominator}`,time:structuredClone(time),value:evaluateAnimation(animation,time),
      interpolation:animation.points.filter(p=>compare(p.time,time)<=0).at(-1)?.interpolation||'linear'});
    const inside=(time:Rational)=>compare(time,animation.points[0].time)>0&&compare(time,animation.points.at(-1)!.time)<0;
    if(inside(start)&&!points.some(p=>compare(p.time,start)===0))points.unshift(boundary(start));
    if(inside(end)&&!points.some(p=>compare(p.time,end)===0))points.push(boundary(end));
    if(!points.length)points.push(boundary(start));
    return {property:animation.property,points};
  });
}
