import {compare,decimal,div,frameTime,micros,mul,nearestFrame,rational,toNumber} from './time.ts';
import type {Rational} from './time.ts';

export type SpeedCurve={points:{x:number;y:number}[]};
export type CurveVelocitySpan={start:number;end:number;from:number;to:number};
type Span=CurveVelocitySpan;
// Observed native control ratios. Math.fround is intentional: the source point clock is float32.
const strength=Math.fround(.8),halfWidth=Math.fround(.2951),usPerSecond=rational(1000000);
const fail=()=>{throw Error('INVALID_CURVE_SPEED');};

export function validateSpeedCurve(curve:SpeedCurve):void{
  if(!curve||!Array.isArray(curve.points)||curve.points.length<2||curve.points.length>100)fail();
  let previous=-1;
  for(const point of curve.points){
    if(!point||!Number.isFinite(point.x)||point.x<0||point.x>1||
      !Number.isFinite(point.y)||point.y<.1||point.y>10||Math.fround(point.x)<=previous)fail();
    previous=Math.fround(point.x);
  }
  if(curve.points[0].x!==0||Math.fround(curve.points.at(-1)!.x)!==1)fail();
}

function nativeTime(time:Rational,positive=false):number{
  const value=toNumber(mul(rational(time.numerator,time.denominator),usPerSecond));
  if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER||(positive&&Math.round(value)<=0))fail();
  return Math.round(value);
}
function validFps(fps:Rational):void{
  const value=toNumber(rational(fps.numerator,fps.denominator));
  if(!Number.isFinite(value)||value<=0||value>1000)fail();
}

function sequencePoints(curve:SpeedCurve):{x:number[];y:number[]}{
  validateSpeedCurve(curve);
  const x=curve.points.map(p=>Math.fround(p.x)),y=curve.points.map(p=>Math.fround(p.y));
  const cumulative=[0];let total=0;
  for(let i=1;i<x.length;i++){
    const mean=Math.fround(Math.fround(y[i]+y[i-1])*.5);
    total=Math.fround(total+Math.fround(Math.fround(x[i]-x[i-1])/mean));
    cumulative.push(total);
  }
  const sequence=cumulative.map(value=>Math.fround(value/total));
  for(let i=1;i<sequence.length;i++)if(sequence[i]<=sequence[i-1])fail();
  return {x:sequence,y};
}

export function curveAverageSpeed(curve:SpeedCurve):number{
  const {x,y}=sequencePoints(curve);let average=0;
  for(let i=1;i<x.length;i++)average+=Math.fround(y[i]+y[i-1])*.5*Math.fround(x[i]-x[i-1]);
  return average;
}

/** New-curve duration only. Existing clips must pass their stored target duration to mapping functions. */
export function curveDuration(curve:SpeedCurve,sourceDuration:Rational,fps:Rational):Rational{
  nativeTime(sourceDuration,true);validFps(fps);
  const frames=mul(div(sourceDuration,decimal(String(curveAverageSpeed(curve)))),fps);
  const count=BigInt(frames.numerator)/BigInt(frames.denominator);
  if(count<1n)throw Error('CURVE_DURATION_EMPTY');
  const microseconds=mul(frameTime(count,fps),usPerSecond);
  return rational(BigInt(microseconds.numerator)/BigInt(microseconds.denominator),1000000);
}

function spans(curve:SpeedCurve,duration:number):Span[]{
  const {x,y}=sequencePoints(curve),out:Span[]=[];
  for(let i=1;i<x.length;i++){
    const length=duration*Math.fround(x[i]-x[i-1]),middle=duration*Math.fround(x[i]+x[i-1])*.5;
    const mean=Math.fround(y[i]+y[i-1])*.5,change=Math.fround(y[i]-y[i-1]);
    const times=[duration*x[i-1],middle-length*halfWidth,middle+length*halfWidth,duration*x[i]];
    const values=[y[i-1],mean-strength*change*.5,mean+strength*change*.5,y[i]];
    if(times.some((time,j)=>j>0&&time<=times[j-1]))fail();
    for(let j=0;j<3;j++)out.push({start:times[j],end:times[j+1],from:values[j],to:values[j+1]});
  }
  return out;
}
function area(span:Span,elapsed:number):number{
  return span.from*elapsed+(span.to-span.from)*elapsed*elapsed/(2*(span.end-span.start));
}
/** Shared velocity model for native media expressions; span start/end are microseconds. */
export function curveVelocitySpans(curve:SpeedCurve,targetDuration:Rational):CurveVelocitySpan[]{
  return spans(curve,nativeTime(targetDuration,true));
}
function mappingTimes(sourceDuration:Rational,targetDuration:Rational,delta:Rational):{source:number;target:number;delta:number}{
  return {source:nativeTime(sourceDuration,true),target:nativeTime(targetDuration,true),delta:nativeTime(delta)};
}

/** Raw media mapping, rounded to microseconds. It never rescales the curve to source/target metadata ratio. */
export function curveSourceDelta(curve:SpeedCurve,sourceDuration:Rational,targetDuration:Rational,targetDelta:Rational):Rational{
  const times=mappingTimes(sourceDuration,targetDuration,targetDelta);
  if(compare(targetDelta,targetDuration)>0)fail();
  let result=0;
  for(const span of spans(curve,times.target)){
    if(times.delta<=span.start)break;
    result+=area(span,Math.min(times.delta,span.end)-span.start);
    if(times.delta<=span.end)break;
  }
  if(!Number.isSafeInteger(Math.round(result)))fail();
  return micros(Math.round(result));
}

/** Inverse media mapping. Queries beyond the curve's covered source area return the explicit target end. */
export function curveTargetDelta(curve:SpeedCurve,sourceDuration:Rational,targetDuration:Rational,sourceDelta:Rational):Rational{
  const times=mappingTimes(sourceDuration,targetDuration,sourceDelta);
  if(compare(sourceDelta,sourceDuration)>0)fail();
  let remaining=times.delta;
  for(const span of spans(curve,times.target)){
    const width=span.end-span.start,full=area(span,width);
    if(remaining>full){remaining-=full;continue;}
    const slope=(span.to-span.from)/width;
    const elapsed=slope===0?remaining/span.from:
      2*remaining/(span.from+Math.sqrt(Math.max(0,span.from*span.from+2*slope*remaining)));
    return micros(Math.round(Math.min(times.target,span.start+Math.min(width,Math.max(0,elapsed)))));
  }
  return micros(times.target);
}

/** A native split snaps to the nearest source frame, then truncates that frame's time to microseconds. */
export function curveNearestFrame(time:Rational,fps:Rational):Rational{
  nativeTime(time);validFps(fps);
  const value=mul(frameTime(nearestFrame(time,fps).numerator,fps),usPerSecond);
  return rational(BigInt(value.numerator)/BigInt(value.denominator),1000000);
}

export function splitSpeedCurve(curve:SpeedCurve,sourceDuration:Rational,targetDuration:Rational,targetDelta:Rational,fps:Rational):{
  left:SpeedCurve;right:SpeedCurve;sourceDelta:Rational;rawSourceDelta:Rational;targetDelta:Rational;
}{
  validateSpeedCurve(curve);
  const at=curveNearestFrame(targetDelta,fps);
  if(compare(at,rational(0))<=0||compare(at,targetDuration)>=0)throw Error('CURVE_SPLIT_EMPTY');
  const rawSourceDelta=curveSourceDelta(curve,sourceDuration,targetDuration,at);
  const sourceDelta=curveNearestFrame(rawSourceDelta,fps);
  if(compare(sourceDelta,rational(0))<=0||compare(sourceDelta,sourceDuration)>=0)throw Error('CURVE_SPLIT_EMPTY');
  const ratio=Math.fround(Math.fround(nativeTime(rawSourceDelta))/Math.fround(nativeTime(sourceDuration,true)));
  if(ratio<=0||ratio>=1)throw Error('CURVE_SPLIT_EMPTY');
  const rightIndex=curve.points.findIndex(point=>point.x>=ratio);
  if(rightIndex<1)throw Error('CURVE_SPLIT_EMPTY');
  const previous=curve.points[rightIndex-1],next=curve.points[rightIndex];
  const t=Math.fround((ratio-previous.x)/(next.x-previous.x));
  const boundary=Math.fround(previous.y+(next.y-previous.y)*t*t*(3-2*t));
  const left:SpeedCurve={points:[...curve.points.filter(point=>point.x<ratio).map(point=>({x:point.x/ratio,y:point.y})),{x:1,y:boundary}]};
  const right:SpeedCurve={points:[{x:0,y:boundary},...curve.points.filter(point=>point.x>ratio).map(point=>({x:(point.x-ratio)/(1-ratio),y:point.y}))]};
  // Avoid a noncanonical 0.9999999999999999 endpoint after double normalization.
  right.points.at(-1)!.x=1;
  validateSpeedCurve(left);validateSpeedCurve(right);
  return {left,right,sourceDelta,rawSourceDelta,targetDelta:at};
}
