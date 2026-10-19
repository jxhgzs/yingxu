import type {Clip,Asset} from '../../core/src/document.ts';
import {curveVelocitySpans,curveSourceDelta} from '../../core/src/curve-speed.ts';
import type {SpeedCurve,CurveVelocitySpan} from '../../core/src/curve-speed.ts';
import {mul,div,add,compare,rational,toNumber,ZERO} from '../../core/src/time.ts';
import type {Rational} from '../../core/src/time.ts';

type CurveClip=Clip&{speedCurve?:SpeedCurve};
type AreaSpan=CurveVelocitySpan&{areaStart:number;areaEnd:number};
/** Decode the source frame containing the exact in-point, including integral coverage past metadata trim. */
export function curveMediaRange(asset:Asset,clip:Clip,fallbackFps:Rational):{start:Rational;end:Rational;origin:Rational}{
 if(!clip.speedCurve)throw Error('INVALID_CURVE_SPEED');
 const coverage=curveSourceDelta(clip.speedCurve,clip.source.duration,clip.target.duration,clip.target.duration);
 if(asset.kind==='image')return {start:ZERO,end:coverage,origin:ZERO};
 const end=add(clip.source.start,coverage);if(compare(end,asset.duration)>0)throw Error('CURVE_SOURCE_COVERAGE_EXCEEDED');
 const fps=asset.fps??fallbackFps,frame=mul(clip.source.start,fps);
 const index=BigInt(frame.numerator)/BigInt(frame.denominator),start=div(rational(index),fps);
 return {start,end,origin:clip.source.start};
}
const fraction=(value:Rational)=>`(${value.numerator}/${value.denominator})`;
const roundUs=(expression:string)=>`floor((${expression})+0.5)`;
const boundedUs=(expression:string,maximum:number)=>roundUs(`min(${maximum},max(0,(${expression})*1000000))`);
function checkExpression(expression:string):void{if(typeof expression!=='string'||!expression.trim()||expression.length>16384)throw Error('INVALID_CURVE_CLOCK_EXPRESSION');}
function microseconds(time:Rational):number{
 const result=Math.round(toNumber(mul(time,rational(1000000))));
 if(!Number.isSafeInteger(result)||result<=0)throw Error('INVALID_CURVE_SPEED');return result;
}
function areaSpans(clip:CurveClip):AreaSpan[]{
 let area=0;
 return curveVelocitySpans(clip.speedCurve!,clip.target.duration).map(span=>{
  const width=span.end-span.start,full=span.from*width+(span.to-span.from)*width*width/(2*width);
  const result={...span,areaStart:area,areaEnd:area+full};area+=full;return result;
 });
}
/** Balanced decisions keep the 100-point case within FFmpeg's expression parse depth. */
function decisions(spans:AreaSpan[],clock:string,edge:(span:AreaSpan)=>number,leaf:(span:AreaSpan)=>string,start=0,end=spans.length):string{
 if(end-start===1)return leaf(spans[start]);
 const middle=start+Math.floor((end-start)/2);
 return `if(lt(${clock},${edge(spans[middle-1])}),${decisions(spans,clock,edge,leaf,start,middle)},${decisions(spans,clock,edge,leaf,middle,end)})`;
}

/** Target-local seconds -> source-local seconds. The curve integral is not rescaled to metadata average speed. */
export function curveSourceExpression(clip:CurveClip,targetDeltaExpression:string):string{
 checkExpression(targetDeltaExpression);
 if(!clip.speedCurve)return `(min(${fraction(clip.target.duration)},max(0,(${targetDeltaExpression})))*${fraction(clip.speed)})`;
 const clock=boundedUs(targetDeltaExpression,microseconds(clip.target.duration)),spans=areaSpans(clip);
 const integral=decisions(spans,clock,span=>span.end,span=>{
  const elapsed=`min(${span.end-span.start},max(0,(${clock}-${span.start})))`,change=span.to-span.from;
  // Constants are cumulative numeric areas. No branch recursively embeds a previous clock expression.
  return `(${span.areaStart}+${span.from}*${elapsed}+(${change})*${elapsed}*${elapsed}/(${2*(span.end-span.start)}))`;
 });
 return `(${roundUs(integral)}/1000000)`;
}

/** Source-local seconds -> target-local seconds, with the core's stable quadratic root and explicit target-end clamp. */
export function curveTargetExpression(clip:CurveClip,sourceDeltaExpression:string):string{
 checkExpression(sourceDeltaExpression);
 if(!clip.speedCurve)return `(min(${fraction(clip.source.duration)},max(0,(${sourceDeltaExpression})))/${fraction(clip.speed)})`;
 const target=microseconds(clip.target.duration),spans=areaSpans(clip);
 const clock=boundedUs(sourceDeltaExpression,Math.max(microseconds(clip.source.duration),Math.round(spans.at(-1)!.areaEnd)));
 const inverse=decisions(spans,clock,span=>span.areaEnd,span=>{
  const width=span.end-span.start,slope=(span.to-span.from)/width,remaining=`max(0,(${clock}-${span.areaStart}))`;
  const elapsed=slope===0?`(${remaining}/${span.from})`:`(2*${remaining}/(${span.from}+sqrt(max(0,${span.from*span.from}+(${2*slope})*${remaining}))))`;
  return `min(${target},(${span.start}+min(${width},max(0,${elapsed}))))`;
 });
 return `(${roundUs(inverse)}/1000000)`;
}
