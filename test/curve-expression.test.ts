import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {curveSourceExpression,curveTargetExpression} from '../packages/media/src/curve-speed.ts';
import {curveSourceDelta,curveTargetDelta,curveDuration} from '../packages/core/src/curve-speed.ts';
import type {SpeedCurve} from '../packages/core/src/curve-speed.ts';
import type {Clip} from '../packages/core/src/document.ts';
import {rational,micros,toNumber} from '../packages/core/src/time.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
const peak:SpeedCurve={points:[{x:0,y:1},{x:.25,y:1},{x:.5,y:5.375},{x:.75,y:1},{x:1,y:1}]};
type CurveClip=Clip&{speedCurve?:SpeedCurve};
function clipFor(curve:SpeedCurve,source=3):CurveClip{return {id:'curve',materialId:'a',source:{start:rational(0),duration:rational(source)},target:{start:rational(0),duration:curveDuration(curve,rational(source),rational(30))},speed:rational(1),speedCurve:curve,editableTiming:true};}
async function nativePts(expression:string,count:number):Promise<number[]>{
 return await new Promise((resolve,reject)=>{
  const args=['-hide_banner','-loglevel','info','-nostdin','-f','lavfi','-i','color=s=2x2:r=30','-vf',`settb=1/1000000,setpts='floor((${expression})*1000000+0.5)',showinfo`,'-frames:v',String(count),'-fps_mode','passthrough','-f','null','-'];
  const child=spawn(ffmpeg(),args,{stdio:['ignore','ignore','pipe']}),timer=setTimeout(()=>child.kill('SIGKILL'),20000);let stderr='';
  child.stderr.setEncoding('utf8');child.stderr.on('data',(s:string)=>{stderr+=s;});child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(Error(stderr.slice(-6000)));return;}const pts=[...stderr.matchAll(/\bn:\s*\d+\s+pts:\s*(-?\d+)/g)].map(m=>Number(m[1]));resolve(pts.slice(0,count));});
 });
}
const micro=(time:ReturnType<typeof rational>)=>Math.round(toNumber(time)*1000000);

test('FFmpeg forward curve expression matches exact core microseconds on native custom-curve clock',async()=>{
 const clip=clipFor(peak),expression=curveSourceExpression(clip,'N/30');
 const count=60,actual=await nativePts(expression,count);
 const expected=Array.from({length:count},(_,frame)=>micro(curveSourceDelta(peak,clip.source.duration,clip.target.duration,micros(Math.min(micro(clip.target.duration),Math.round(frame*1000000/30))))));
 assert.deepEqual(actual,expected);
});
test('FFmpeg inverse expression has stable rising/falling/flat roots and covered-source end clamp',async()=>{
 const curves=[peak,{points:[{x:0,y:4},{x:1,y:.5}]},{points:[{x:0,y:2},{x:1,y:2}]},{points:[{x:0,y:.1},{x:1,y:.1}]}];
 for(const curve of curves){
  const clip=clipFor(curve),count=92,expression=curveTargetExpression(clip,'N/30');
  const actual=await nativePts(expression,count),expected=Array.from({length:count},(_,frame)=>micro(curveTargetDelta(curve,clip.source.duration,clip.target.duration,micros(Math.min(3000000,Math.round(frame*1000000/30))))));
  assert.deepEqual(actual,expected,JSON.stringify(curve));
 }
});
test('FFmpeg curve expression clamps negative clock and its input end before mapping',async()=>{
 const clip=clipFor(peak),actual=await nativePts(curveSourceExpression(clip,'N/30-0.1'),65);
 const expected=Array.from({length:65},(_,frame)=>micro(curveSourceDelta(peak,clip.source.duration,clip.target.duration,micros(Math.max(0,Math.min(micro(clip.target.duration),Math.round((frame/30-.1)*1000000)))))));
 assert.deepEqual(actual,expected);
});
test('100-point expressions stay linear in size and parse in real FFmpeg',async()=>{
 const curve:SpeedCurve={points:Array.from({length:100},(_,i)=>({x:i/99,y:.2+(i%7)*.6}))},clip=clipFor(curve,30);
 const source=curveSourceExpression(clip,'N/5'),target=curveTargetExpression(clip,'N/4');
 assert(source.length<250000,`forward ${source.length}`);assert(target.length<250000,`inverse ${target.length}`);
 const count=130,actual=await nativePts(source,count),expected=Array.from({length:count},(_,frame)=>micro(curveSourceDelta(curve,clip.source.duration,clip.target.duration,micros(Math.min(micro(clip.target.duration),Math.round(frame*1000000/5))))));
 assert.deepEqual(actual,expected);
 const inverse=await nativePts(target,count),targetExpected=Array.from({length:count},(_,frame)=>micro(curveTargetDelta(curve,clip.source.duration,clip.target.duration,micros(Math.min(30000000,Math.round(frame*1000000/4))))));
 assert.deepEqual(inverse,targetExpected);
});

test('constant-speed fallback remains a native expression without requiring a curve',async()=>{
 const clip=clipFor(peak);delete clip.speedCurve;clip.speed=rational(3,2);clip.target.duration=rational(2);
 const actual=await nativePts(curveSourceExpression(clip,'N/30'),62);
 assert.deepEqual(actual,Array.from({length:62},(_,n)=>Math.round(Math.min(2,n/30)*1.5*1000000)));
 assert.throws(()=>curveSourceExpression(clip,''),/INVALID_CURVE_CLOCK_EXPRESSION/);
});
