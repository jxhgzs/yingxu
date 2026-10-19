import type {Clip} from '../../../../packages/core/src/document.ts';
import {curveVelocitySpans} from '../../../../packages/core/src/curve-speed.ts';
import {add,compare,decimal,micros,mul,rational,sub,toNumber,ZERO} from '../../../../packages/core/src/time.ts';
import type {Rational} from '../../../../packages/core/src/time.ts';

export type CurveClockSample={sourceTime:Rational;sourceSeconds:number;playbackRate:number;targetSeconds:number};
export type CurveClock={sample(time:number|Rational):CurveClockSample;targetDrift(actualSourceSeconds:number,time:number|Rational):number};

/** The native-derived curve's velocity is ds/dt in target time. No average-rate or
 * source/target endpoint normalization is introduced here. Construct once per clip. */
export function createCurveClock(clip:Clip):CurveClock{
 if(!clip.speedCurve)throw Error('CURVE_CLOCK_REQUIRES_CURVE');
 const spans=curveVelocitySpans(clip.speedCurve,clip.target.duration),targetStart=toNumber(clip.target.start),sourceStart=toNumber(clip.source.start);
 const cumulative:number[]=[];let total=0;
 for(const span of spans){cumulative.push(total);const width=span.end-span.start;total+=(span.from+span.to)*width/2;}
 function sample(time:number|Rational):CurveClockSample{
  const seconds=typeof time==='number'?time:toNumber(time);if(!Number.isFinite(seconds))throw Error('CURVE_CLOCK_TIME_INVALID');
  const query=typeof time==='number'?decimal(time.toFixed(9)):time;let targetDelta=sub(query,clip.target.start);
  if(compare(targetDelta,ZERO)<0)targetDelta=ZERO;else if(compare(targetDelta,clip.target.duration)>0)targetDelta=clip.target.duration;
  const targetSeconds=targetStart+toNumber(targetDelta),delta=Math.round(toNumber(mul(targetDelta,rational(1000000))));
  // Use the same right span at an exact boundary; velocity is continuous there.
  let low=0,high=spans.length-1;
  while(low<high){const middle=(low+high)>>1;if(delta>=spans[middle].end)low=middle+1;else high=middle;}
  const span=spans[low],elapsed=Math.max(0,Math.min(delta-span.start,span.end-span.start)),slope=(span.to-span.from)/(span.end-span.start);
  const sourceDelta=Math.round(cumulative[low]+span.from*elapsed+slope*elapsed*elapsed/2),playbackRate=span.from+slope*elapsed;
  return {sourceTime:add(clip.source.start,micros(sourceDelta)),sourceSeconds:sourceStart+sourceDelta/1e6,playbackRate,targetSeconds};
 }
 return {sample,targetDrift(actualSourceSeconds,time){if(!Number.isFinite(actualSourceSeconds))return Infinity;const current=sample(time);return Math.abs(actualSourceSeconds-current.sourceSeconds)/current.playbackRate;}};
}

/** A midpoint rate minimizes the local integration error when a linear velocity
 * is held until the next RAF. Exact source time remains authoritative for seek. */
export function curvePlaybackRate(clock:CurveClock,time:number|Rational,lookAheadSeconds=0):number{
 if(!Number.isFinite(lookAheadSeconds)||lookAheadSeconds<0||lookAheadSeconds>.1)throw Error('CURVE_CLOCK_LOOKAHEAD_INVALID');
 const seconds=typeof time==='number'?time:toNumber(time);return clock.sample(decimal((seconds+lookAheadSeconds/2).toFixed(9))).playbackRate;
}
