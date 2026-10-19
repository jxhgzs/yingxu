import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurveClock,curvePlaybackRate} from '../apps/editor/src/preview/curve-clock.ts';
import {sourceTimeAt} from '../packages/core/src/animation.ts';
import {curveVelocitySpans} from '../packages/core/src/curve-speed.ts';
import type {Clip} from '../packages/core/src/document.ts';
import {decimal,micros,rational,toNumber} from '../packages/core/src/time.ts';
const curve={points:[{x:0,y:1},{x:.25,y:1},{x:.5,y:5.375},{x:.75,y:1},{x:1,y:1}]};
function clip():Clip{return {id:'curve',materialId:'source',source:{start:rational(1,10),duration:rational(3)},target:{start:rational(6),duration:micros(1966666)},speed:decimal('1.5223880801349878'),editableTiming:true,speedCurve:structuredClone(curve)};}

test('cached curve clock reproduces authoritative rounded source mapping at every microsecond edge and output frame',()=>{
 const c=clip(),clock=createCurveClock(c),spans=curveVelocitySpans(c.speedCurve!,c.target.duration),times=[...Array.from({length:60},(_,i)=>6+i/30),...spans.flatMap(s=>[s.start,s.end].flatMap(v=>[-1,0,1].map(d=>6+(Math.round(v)+d)/1e6)))];
 for(const time of times){const at=decimal(time.toFixed(9)),actual=clock.sample(at);assert.deepEqual(actual.sourceTime,sourceTimeAt(c,at),String(time));assert(actual.playbackRate>=.1&&actual.playbackRate<=10);}
 assert.deepEqual(clock.sample(-1).sourceTime,c.source.start);assert.deepEqual(clock.sample(100).sourceTime,sourceTimeAt(c,rational(100)));
 assert.throws(()=>clock.sample(NaN),/TIME_INVALID/);
});
test('instantaneous velocity follows existing three-piece spans instead of metadata average',()=>{
 const c=clip(),clock=createCurveClock(c),spans=curveVelocitySpans(c.speedCurve!,c.target.duration);
 for(const span of spans){const local=(span.start+span.end)/2,at=6+local/1e6,actual=clock.sample(at),rounded=Math.round(local),expected=span.from+(span.to-span.from)*(rounded-span.start)/(span.end-span.start);assert(Math.abs(actual.playbackRate-expected)<1e-10);}
 assert(Math.abs(clock.sample(6.983333).playbackRate-toNumber(c.speed))>3);
 const now=clock.sample(6.9);assert(Math.abs(clock.targetDrift(now.sourceSeconds+.1,6.9)-.1/now.playbackRate)<1e-12);
 assert.equal(clock.targetDrift(NaN,6.9),Infinity);
 assert.throws(()=>createCurveClock({...c,speedCurve:undefined}),/REQUIRES_CURVE/);
});
test('midpoint playback-rate lookahead integrates a linear velocity over one RAF without average-speed substitution',()=>{
 const c=clip(),clock=createCurveClock(c),time=6.85,step=1/60;
 const first=clock.sample(time),last=clock.sample(time+step),rate=curvePlaybackRate(clock,time,step);
 assert(Math.abs(rate*step-(last.sourceSeconds-first.sourceSeconds))<2e-6);
 assert.throws(()=>curvePlaybackRate(clock,time,-.1),/LOOKAHEAD_INVALID/);
 assert.throws(()=>curvePlaybackRate(clock,time,.2),/LOOKAHEAD_INVALID/);
});
test('moved fractional target clocks and varied speed points retain the core integer-microsecond source mapping',()=>{
 let seed=731;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
 for(let variant=0;variant<12;variant++){
  const c=clip();c.target.start=rational(17,30);c.speedCurve={points:Array.from({length:8},(_,i)=>({x:i/7,y:.1+random()*9.9}))};const clock=createCurveClock(c);
  for(let i=0;i<=200;i++){const at=rational(17*1000000+Math.round(i*1966666/200)*30,30000000);assert.deepEqual(clock.sample(at).sourceTime,sourceTimeAt(c,at));}
 }
});
