import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import type {Asset,Clip} from '../../core/src/document.ts';
import {check,validRational} from '../../core/src/document.ts';
import {curveSourceDelta,curveVelocitySpans,validateSpeedCurve} from '../../core/src/curve-speed.ts';
import type {SpeedCurve} from '../../core/src/curve-speed.ts';
import {add,sub,compare,micros,mul,rational,toNumber,ZERO} from '../../core/src/time.ts';
import type {Rational} from '../../core/src/time.ts';
import {ffmpeg,ffprobe} from './probe.ts';
import {runProcess} from './process.ts';

export type CurveAudioMap={sampleRate:number;sourceSamples:number;targetSamples:number;coverage:Rational;points:{sourceSample:number;targetSample:number}[]};
export type CurveAudioOptions={sampleRate:number;signal?:AbortSignal;onProgress?:(progress:number)=>void};
type CurveClip=Clip&{speedCurve?:SpeedCurve};
function sampleAt(time:Rational,rate:number):number{
 const exact=mul(time,rational(rate)),n=BigInt(exact.numerator),d=BigInt(exact.denominator),value=Number((2n*n+d)/(2n*d));
 check(Number.isSafeInteger(value)&&value>=0,'CURVE_AUDIO_TIME_LIMIT');return value;
}
function buildMap(clip:CurveClip,sampleRate:number):CurveAudioMap{
 const curve=clip.speedCurve!;
 const coverage=curveSourceDelta(curve,clip.source.duration,clip.target.duration,clip.target.duration);
 const sourceSamples=sampleAt(coverage,sampleRate),targetSamples=sampleAt(clip.target.duration,sampleRate);
 check(sourceSamples>0&&targetSamples>0,'CURVE_AUDIO_EMPTY');
 const targetUs=sampleAt(clip.target.duration,1000000),gridCount=Math.floor(targetUs/20000);
 check(gridCount+curve.points.length*3<=200000,'CURVE_AUDIO_MAP_LIMIT');
 const times:{time:Rational;priority:number}[]=[];
 for(let us=20000;us<targetUs;us+=20000)times.push({time:micros(us),priority:0});
 for(const span of curveVelocitySpans(curve,clip.target.duration)){
  const time=micros(Math.round(span.end));if(compare(time,clip.target.duration)<0&&compare(time,ZERO)>0)times.push({time,priority:1});
 }
 const candidates=times.map(({time,priority})=>({sourceSample:sampleAt(curveSourceDelta(curve,clip.source.duration,clip.target.duration,time),sampleRate),targetSample:sampleAt(time,sampleRate),priority}))
  .filter(p=>p.sourceSample>0&&p.sourceSample<sourceSamples&&p.targetSample>0&&p.targetSample<targetSamples)
  .sort((a,b)=>a.targetSample-b.targetSample||b.priority-a.priority);
 const gap=Math.max(1,Math.round(sampleRate*.005)),selected:typeof candidates=[];
 for(const point of candidates){
  const last=selected.at(-1),previous=selected.at(-2),fits=(prior:typeof last)=>point.sourceSample-(prior?.sourceSample||0)>=gap&&point.targetSample-(prior?.targetSample||0)>=gap;
  if(fits(last))selected.push(point);
  else if(last&&point.priority>last.priority&&fits(previous))selected[selected.length-1]=point;
 }
 while(selected.length&&(sourceSamples-selected.at(-1)!.sourceSample<gap||targetSamples-selected.at(-1)!.targetSample<gap))selected.pop();
 return {sampleRate,sourceSamples,targetSamples,coverage,points:selected.map(({sourceSample,targetSample})=>({sourceSample,targetSample}))};
}
async function engine(binary:string,args:string[],directory:string,signal?:AbortSignal):Promise<void>{
 if(signal?.aborted)throw Error('JOB_CANCELLED');
 const stderrFile=path.join(directory,'rubberband.stderr.log'),stdoutFile=path.join(directory,'rubberband.stdout.log');
 await new Promise<void>((resolve,reject)=>{
  const stderrLog=createWriteStream(stderrFile),stdoutLog=createWriteStream(stdoutFile),child=spawn(binary,args,{stdio:['ignore','pipe','pipe']});
  const logs=Promise.allSettled([finished(stderrLog),finished(stdoutLog)]);
  stderrLog.on('error',()=>child.kill('SIGTERM'));stdoutLog.on('error',()=>child.kill('SIGTERM'));
  let stderr='',hasWarning=false,spawnError:NodeJS.ErrnoException|undefined,cancelled=false,killTimer:ReturnType<typeof setTimeout>|undefined;
  const cancel=()=>{cancelled=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);};
  const timeout=setTimeout(()=>child.kill('SIGKILL'),1800000);
  signal?.addEventListener('abort',cancel,{once:true});
  child.stderr.pipe(stderrLog);child.stdout.pipe(stdoutLog);child.stderr.setEncoding('utf8');
  child.stderr.on('data',(part:string)=>{const combined=stderr+part;if(/\b(?:warning|nan|inf(?:inity)?)\b/i.test(combined))hasWarning=true;stderr=combined.slice(-64000);});child.on('error',error=>{spawnError=error;});
  child.on('close',async code=>{
   clearTimeout(timeout);clearTimeout(killTimer);signal?.removeEventListener('abort',cancel);
   const logResults=await logs;const failedLog=logResults.find(r=>r.status==='rejected');if(failedLog?.status==='rejected'){reject(failedLog.reason);return;}
   if(cancelled||signal?.aborted){reject(Error('JOB_CANCELLED'));return;}
   if(spawnError){reject(Error(`${spawnError.code==='ENOENT'?'CURVE_AUDIO_ENGINE_UNAVAILABLE':'CURVE_AUDIO_ENGINE_FAILED'}: ${binary}; ${stderrFile}`));return;}
   if(code!==0){reject(Error(`CURVE_AUDIO_ENGINE_FAILED: ${code}; ${stderrFile}; ${stderr.slice(-2000)}`));return;}
   if(hasWarning){reject(Error(`CURVE_AUDIO_ENGINE_WARNING: ${stderrFile}; ${stderr.slice(-2000)}`));return;}
   resolve();
  });
 });
}
async function finiteAudio(file:string,directory:string,signal?:AbortSignal):Promise<void>{
 const result=await runProcess(ffmpeg(),['-hide_banner','-nostdin','-i',file,'-af','astats=metadata=1:reset=0','-f','null','-'],{signal,timeout:120000});
 await fs.writeFile(path.join(directory,path.basename(file)+'.scan.log'),result.stderr);
 const counts=[...result.stderr.matchAll(/Number of (NaNs|Infs):\s+(\S+)/g)];
 check(['NaNs','Infs'].every(kind=>counts.some(m=>m[1]===kind))&&counts.every(m=>Number.isFinite(Number(m[2]))&&Number(m[2])===0),'CURVE_AUDIO_NONFINITE',file);
}
async function wavSamples(file:string,sampleRate:number,signal?:AbortSignal):Promise<number>{
 const result=await runProcess(ffprobe(),['-v','error','-show_streams','-show_format','-of','json',file],{signal,timeout:30000});
 const info=JSON.parse(result.stdout),stream=info.streams?.find((s:any)=>s.codec_type==='audio');
 check(stream&&Number(stream.sample_rate)===sampleRate&&Number(stream.channels)===2,'CURVE_AUDIO_INVALID_OUTPUT');
 const match=/^(\d+)\/(\d+)$/.exec(String(stream.time_base)),ticks=Number(stream.duration_ts);
 check(match&&Number.isSafeInteger(ticks)&&ticks>0,'CURVE_AUDIO_INVALID_OUTPUT');
 const count=ticks*Number(match[1])*sampleRate/Number(match[2]);check(Number.isSafeInteger(count),'CURVE_AUDIO_INVALID_OUTPUT');return count;
}

/** Offline, pitch-preserving curve audio. No constant-speed or silent-track fallback. */
export async function renderCurveAudio(asset:Asset,clip:CurveClip,directory:string,options:CurveAudioOptions):Promise<{path:string;sampleCount:number;timemap:CurveAudioMap}>{
 check(clip.speedCurve,'CURVE_AUDIO_REQUIRES_CURVE');validateSpeedCurve(clip.speedCurve);
 check(asset.kind==='audio'||asset.hasAudio===true,'CURVE_AUDIO_NO_STREAM');check(asset.kind!=='text'&&asset.id===clip.materialId,'CURVE_AUDIO_INVALID_ASSET');
 check(options&&Number.isInteger(options.sampleRate)&&options.sampleRate>=8000&&options.sampleRate<=192000,'CURVE_AUDIO_INVALID_RATE');
 for(const time of [clip.source.start,clip.source.duration,clip.target.duration,asset.duration])validRational(time);
 check(compare(clip.source.start,ZERO)>=0&&compare(clip.source.duration,ZERO)>0&&compare(clip.target.duration,ZERO)>0&&compare(add(clip.source.start,clip.source.duration),asset.duration)<=0,'CURVE_AUDIO_INVALID_RANGE');
 if(options.signal?.aborted)throw Error('JOB_CANCELLED');
 const map=buildMap(clip,options.sampleRate);await fs.mkdir(directory,{recursive:true});
 check(compare(map.coverage,sub(asset.duration,clip.source.start))<=0,'CURVE_SOURCE_COVERAGE_EXCEEDED');
 const work=await fs.mkdtemp(path.join(path.resolve(directory),'curve-audio-')),source=path.join(work,'source.wav'),partial=path.join(work,'output.partial.wav'),output=path.join(work,'output.wav'),mapFile=path.join(work,'timemap.txt');
 await fs.writeFile(path.join(work,'timemap.json'),JSON.stringify(map));
 await fs.writeFile(mapFile,map.points.map(p=>`${p.sourceSample} ${p.targetSample}`).join('\n')+'\n');options.onProgress?.(.05);
 await runProcess(ffmpeg(),['-hide_banner','-loglevel','warning','-nostdin','-y','-i',asset.path,'-map','0:a:0','-af',`atrim=start=${toNumber(clip.source.start).toFixed(9)}:duration=${toNumber(map.coverage).toFixed(9)},asetpts=PTS-STARTPTS`,'-ar',String(options.sampleRate),'-ac','2','-c:a','pcm_f32le',source],{signal:options.signal,timeout:1800000});
 const actualSource=await wavSamples(source,options.sampleRate,options.signal);check(Math.abs(actualSource-map.sourceSamples)<=1,'CURVE_AUDIO_SOURCE_LENGTH');
 await finiteAudio(source,work,options.signal);options.onProgress?.(.25);
 const binary=process.env.YINGXU_RUBBERBAND||'/opt/homebrew/bin/rubberband';
 const args=['-q','-3','--window-short','--timemap',mapFile,'-D',toNumber(clip.target.duration).toFixed(9),source,partial];
 const binaryHash=await fs.readFile(binary).then(data=>createHash('sha256').update(data).digest('hex')).catch(()=>undefined);
 await fs.writeFile(path.join(work,'engine.json'),JSON.stringify({binary,sha256:binaryHash,args,ffmpeg:ffmpeg(),sampleRate:options.sampleRate,clipId:clip.id},null,2));
 await engine(binary,args,work,options.signal);options.onProgress?.(.8);
 const sampleCount=await wavSamples(partial,options.sampleRate,options.signal);check(Math.abs(sampleCount-map.targetSamples)<=1,'CURVE_AUDIO_LENGTH_MISMATCH');
 await finiteAudio(partial,work,options.signal);if(options.signal?.aborted)throw Error('JOB_CANCELLED');
 await fs.rename(partial,output);options.onProgress?.(1);return {path:output,sampleCount,timemap:map};
}
