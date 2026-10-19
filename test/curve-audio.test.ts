import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {renderCurveAudio} from '../packages/media/src/curve-audio.ts';
import {curveDuration,curveTargetDelta} from '../packages/core/src/curve-speed.ts';
import type {SpeedCurve} from '../packages/core/src/curve-speed.ts';
import type {Asset,Clip} from '../packages/core/src/document.ts';
import {rational,decimal,toNumber} from '../packages/core/src/time.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
const rate=48000,curve:SpeedCurve={points:[{x:0,y:1},{x:.25,y:1},{x:.5,y:5.375},{x:.75,y:1},{x:1,y:1}]};
type CurveClip=Clip&{speedCurve:SpeedCurve};
function clip():CurveClip{return {id:'curve',materialId:'a',source:{start:decimal('0.1'),duration:rational(3)},target:{start:rational(0),duration:curveDuration(curve,rational(3),rational(30))},speed:rational(1),speedCurve:curve,editableTiming:true};}
async function fixture(folder:string){
 const file=path.join(folder,'mixed.wav'),events=[.35,.9,1.5,2.4],count=rate*4,data=Buffer.alloc(count*2);
 for(let i=0;i<count;i++){
  const time=i/rate;let value=.025*Math.sin(2*Math.PI*440*time);
  for(const event of events){const delta=time-event-.1;if(Math.abs(delta)<.02)value+=.35*Math.exp(-((delta/.004)**2))*Math.sin(2*Math.PI*2000*time);}
  data.writeInt16LE(Math.round(value*32767),i*2);
 }
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(data.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
 await fs.writeFile(file,Buffer.concat([header,data]));return {asset:{id:'a',path:file,kind:'audio',duration:rational(4),hasAudio:true} as Asset,events};
}
async function decoded(file:string):Promise<Float32Array>{return await new Promise((resolve,reject)=>{
 const child=spawn(ffmpeg(),['-v','error','-i',file,'-ac','1','-ar',String(rate),'-f','f32le','-c:a','pcm_f32le','-'],{stdio:['ignore','pipe','pipe']}),parts:Buffer[]=[];let error='';child.stdout.on('data',s=>parts.push(s));child.stderr.on('data',s=>error+=s);child.on('error',reject);child.on('close',code=>{if(code!==0){reject(Error(error));return;}const b=Buffer.concat(parts),copy=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);resolve(new Float32Array(copy));});
});}
function tonePeak(samples:Float32Array,start:number):number{
 const at=Math.round(start*rate),size=4096;let best=-Infinity,frequency=0;
 for(let hz=420;hz<=460;hz++){
  let real=0,imag=0;for(let n=0;n<size;n++){const value=samples[at+n]*(.5-.5*Math.cos(2*Math.PI*n/(size-1))),angle=2*Math.PI*hz*n/rate;real+=value*Math.cos(angle);imag+=value*Math.sin(angle);}
  const power=real*real+imag*imag;if(power>best){best=power;frequency=hz;}
 }
 return frequency;
}
test('offline curve audio preserves sample count, pitch and mixed marker times with an original source offset',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-audio-'));
 try{
  const {asset,events}=await fixture(directory),c=clip(),progress:number[]=[],result=await renderCurveAudio(asset,c,directory,{sampleRate:rate,onProgress:p=>progress.push(p)});
  assert(Math.abs(result.sampleCount-Math.round(toNumber(c.target.duration)*rate))<=1);
  assert(result.timemap.points.length>10);assert.equal(progress.at(-1),1);
  let source=0,target=0;for(const point of result.timemap.points){assert(point.sourceSample>source&&point.targetSample>target);assert(point.sourceSample<result.timemap.sourceSamples&&point.targetSample<result.timemap.targetSamples);source=point.sourceSample;target=point.targetSample;}
  assert(!/warning|\bnan\b|\binf\b/i.test(await fs.readFile(path.join(path.dirname(result.path),'rubberband.stderr.log'),'utf8')));
  const samples=await decoded(result.path);assert.equal(samples.length,result.sampleCount);
  for(const at of [.1,1.65])assert(Math.abs(tonePeak(samples,at)-440)<=5);
  const measured:{source:number;expected:number;actual:number;centroid:number}[]=[];
  for(const event of events){
   const expected=toNumber(curveTargetDelta(curve,c.source.duration,c.target.duration,decimal(String(event))));let index=Math.round(Math.max(0,expected-.08)*rate),peak=index;
   for(;index<Math.min(samples.length,Math.round((expected+.08)*rate));index++)if(Math.abs(samples[index])>Math.abs(samples[peak]))peak=index;
   let mass=0,weighted=0;for(let n=Math.round(Math.max(0,expected-.08)*rate);n<Math.min(samples.length,Math.round((expected+.08)*rate));n++){const weight=Math.max(0,samples[n]*samples[n]-.025*.025/2);mass+=weight;weighted+=n*weight;}
   measured.push({source:event,expected,actual:peak/rate,centroid:weighted/mass/rate});
  }
  // Energy centroid locates a shaped event; a single carrier maximum can move under phase-preserving stretch.
  assert(measured.every(p=>Math.abs(p.centroid-p.expected)<=.02),JSON.stringify(measured));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('curve audio rejects missing engine and cancellation explicitly',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-audio-errors-')),previous=process.env.YINGXU_RUBBERBAND;
 try{
  const {asset}=await fixture(directory),c=clip(),controller=new AbortController();controller.abort();
  await assert.rejects(renderCurveAudio(asset,c,directory,{sampleRate:rate,signal:controller.signal}),/JOB_CANCELLED/);
  process.env.YINGXU_RUBBERBAND=path.join(directory,'missing-engine');
  await assert.rejects(renderCurveAudio(asset,c,directory,{sampleRate:rate}),/CURVE_AUDIO_ENGINE_UNAVAILABLE/);
 }finally{if(previous===undefined)delete process.env.YINGXU_RUBBERBAND;else process.env.YINGXU_RUBBERBAND=previous;await fs.rm(directory,{recursive:true,force:true});}
});

test('curve audio preserves engine diagnostics, rejects nonfinite warnings and cancels an active engine',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-audio-engine-')),previous=process.env.YINGXU_RUBBERBAND;
 try{
  const {asset}=await fixture(directory),c=clip(),fake=path.join(directory,'fake-engine');
  process.env.YINGXU_RUBBERBAND=fake;
  await fs.writeFile(fake,`#!${process.execPath}\nprocess.stderr.write('WARNING: NaN or Inf presented for time ratio\\n');process.stderr.write('x'.repeat(70000));\n`,{mode:0o700});
  await assert.rejects(renderCurveAudio(asset,c,directory,{sampleRate:rate}),/CURVE_AUDIO_ENGINE_WARNING/);
  const works=(await fs.readdir(directory)).filter(n=>n.startsWith('curve-audio-'));
  const saved=await fs.readFile(path.join(directory,works[0],'rubberband.stderr.log'),'utf8');assert(saved.startsWith('WARNING: NaN'));assert(saved.length>70000);
  await fs.writeFile(fake,`#!${process.execPath}\nprocess.stdout.write('engine ready\\n');setTimeout(()=>{},60000);\n`,{mode:0o700});
  const controller=new AbortController(),started=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
  try{await assert.rejects(renderCurveAudio(asset,c,directory,{sampleRate:rate,signal:controller.signal,onProgress:p=>{if(p===.25)timer=setTimeout(()=>controller.abort(),100);}}),/JOB_CANCELLED/);}
  finally{clearTimeout(timer);}
  assert(Date.now()-started<5000,'cancel should stop the owned engine promptly');
 }finally{if(previous===undefined)delete process.env.YINGXU_RUBBERBAND;else process.env.YINGXU_RUBBERBAND=previous;await fs.rm(directory,{recursive:true,force:true});}
});

test('curve audio rejects a wrong sample count or nonfinite samples without padding or trimming them',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-audio-invalid-')),previous=process.env.YINGXU_RUBBERBAND;
 try{
  const {asset}=await fixture(directory),c=clip(),fake=path.join(directory,'fake-output');process.env.YINGXU_RUBBERBAND=fake;
  const writer=(wrongCount:boolean,nan:boolean)=>`#!${process.execPath}\nconst fs=require('node:fs'),args=process.argv.slice(2),rate=48000,frames=Math.round(Number(args[args.indexOf('-D')+1])*rate)-${wrongCount?100:0};const data=Buffer.alloc(frames*8);${nan?'data.writeFloatLE(NaN,128);':''}const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(data.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(3,20);h.writeUInt16LE(2,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*8,28);h.writeUInt16LE(8,32);h.writeUInt16LE(32,34);h.write('data',36);h.writeUInt32LE(data.length,40);fs.writeFileSync(args.at(-1),Buffer.concat([h,data]));\n`;
  await fs.writeFile(fake,writer(true,false),{mode:0o700});
  await assert.rejects(renderCurveAudio(asset,c,directory,{sampleRate:rate}),/CURVE_AUDIO_LENGTH_MISMATCH/);
  await fs.writeFile(fake,writer(false,true),{mode:0o700});
  await assert.rejects(renderCurveAudio(asset,c,directory,{sampleRate:rate}),/CURVE_AUDIO_NONFINITE/);
  const workdirs=(await fs.readdir(directory)).filter(n=>n.startsWith('curve-audio-'));
  for(const work of workdirs)assert(!(await fs.readdir(path.join(directory,work))).includes('output.wav'),'invalid partial output must not be committed');
 }finally{if(previous===undefined)delete process.env.YINGXU_RUBBERBAND;else process.env.YINGXU_RUBBERBAND=previous;await fs.rm(directory,{recursive:true,force:true});}
});

test('curve audio supports the default 44.1kHz output and validated extreme curve rates',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-audio-rates-'));
 try{
  const {asset}=await fixture(directory),c=clip();
  const normal=await renderCurveAudio(asset,c,directory,{sampleRate:44100});assert(Math.abs(normal.sampleCount-Math.round(toNumber(c.target.duration)*44100))<=1);
  for(const speed of [.1,10]){
   const flat:SpeedCurve={points:[{x:0,y:speed},{x:1,y:speed}]},part={...c,speedCurve:flat,target:{...c.target,duration:curveDuration(flat,c.source.duration,rational(30))}};
   const result=await renderCurveAudio(asset,part,directory,{sampleRate:rate});assert(Math.abs(result.sampleCount-Math.round(toNumber(part.target.duration)*rate))<=1);
  }
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
