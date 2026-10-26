import fs from 'node:fs/promises';import path from 'node:path';
import {ffmpeg,ffprobe,probe} from './probe.ts';import {runProcess} from './process.ts';
import {check} from '../../core/src/document.ts';import type {Asset} from '../../core/src/document.ts';
import {toNumber} from '../../core/src/time.ts';import type {Rational} from '../../core/src/time.ts';
type Options={signal?:AbortSignal;onProgress?:(value:number)=>void;chunkFrames?:number};
const seconds=(v:number)=>v.toFixed(9),common=['-hide_banner','-loglevel','error','-y','-threads','2','-filter_threads','1'];
const active=(signal?:AbortSignal)=>{if(signal?.aborted)throw Error('JOB_CANCELLED');};
export async function verifyFrameClock(asset:Asset,signal?:AbortSignal){
 const fps=asset.fps?toNumber(asset.fps):0;check(fps>0,'MEDIA_OPERATION_FRAME_TIMING');const metadata=await probe(asset.path,{signal}),base=String(metadata.streams.find((s:any)=>s.codec_type==='video')?.time_base||'0/1').split('/').map(Number),tolerance=Math.max(.00002,base[0]/base[1]/2+.000002);let frames=0,valid=true;
 await runProcess(ffprobe(),['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',asset.path],{signal,timeout:120000,onLine:line=>{const value=line.split(',')[0].trim();if(!value)return;const time=Number(value);if(!Number.isFinite(time)||Math.abs(time-frames/fps)>tolerance)valid=false;frames++;}});
 check(valid&&frames>0,'MEDIA_OPERATION_FRAME_TIMING');return frames;
}
export async function freezeMedia(asset:Asset,time:Rational,directory:string,options:Options={}){
 active(options.signal);const frames=await verifyFrameClock(asset,options.signal);await fs.mkdir(directory,{recursive:true});const fps=asset.fps?toNumber(asset.fps):30,frame=Math.max(0,Math.floor(toNumber(time)*fps+1e-7)),anchor=Math.floor(frame/fps),first=Math.ceil(anchor*fps-1e-7),file=path.join(directory,'freeze.png');check(frame<frames,'FREEZE_OUTSIDE_CLIP');
 await runProcess(ffmpeg(),[...common,'-ss',String(anchor),'-i',asset.path,'-vf',`select=eq(n\\,${frame-first}),format=rgba`,'-frames:v','1','-an',file],{signal:options.signal});
 active(options.signal);await fs.stat(file);options.onProgress?.(1);return file;
}
/** Reverse bounded decoded windows; lossless intermediates are encoded once for browser playback. */
export async function reverseMedia(asset:Asset,start:Rational,length:Rational,directory:string,options:Options={}){
 active(options.signal);const metadata=await probe(asset.path,{signal:options.signal}),stream=metadata.streams.find((s:any)=>s.codec_type==='video');check(stream&&asset.width&&asset.height&&asset.fps,'REVERSE_MEDIA_UNSUPPORTED');
 const frameCount=await verifyFrameClock(asset,options.signal);
 const fps=toNumber(asset.fps),rate=`${asset.fps.numerator}/${asset.fps.denominator}`,begin=toNumber(start),duration=toNumber(length);
 check(duration>0&&duration<=3600&&fps>0&&fps<=120,'REVERSE_MEDIA_LIMIT');
 const frameBytes=asset.width*asset.height*4,maxFrames=Math.floor(128*1024*1024/frameBytes);check(maxFrames>=1,'REVERSE_FRAME_TOO_LARGE');
 const chunk=Math.max(1,Math.min(options.chunkFrames||120,maxFrames,120)),first=Math.floor(begin*fps+1e-7),end=Math.ceil((begin+duration)*fps-1e-7),total=end-first;check(end<=frameCount,'MEDIA_OPERATION_FRAME_TIMING');
 const temporary=path.join(directory,'reverse-parts'),videos:string[]=[],audios:string[]=[];await fs.mkdir(temporary,{recursive:true});
 try{
  for(let a=first;a<end;a+=chunk){
   active(options.signal);const b=Math.min(a+chunk,end),anchor=Math.floor(a/fps),anchorFrame=Math.ceil(anchor*fps-1e-7),file=`video-${a}.nut`;
   await runProcess(ffmpeg(),[...common,'-ss',String(anchor),'-i',asset.path,'-an','-vf',`trim=start_frame=${a-anchorFrame}:end_frame=${b-anchorFrame},reverse,setpts=N/(${rate}*TB)`,'-frames:v',String(b-a),'-r',rate,'-c:v','ffv1','-level','3','-pix_fmt','bgr0',path.join(temporary,file)],{signal:options.signal});
   videos.unshift(file);options.onProgress?.(.7*(b-first)/total);
  }
  if(asset.hasAudio){
   const sampleRate=48000,sourceStart=Math.round(begin*sampleRate),sampleCount=Math.round(duration*sampleRate),window=8*sampleRate;
   for(let a=0;a<sampleCount;a+=window){
    active(options.signal);const b=Math.min(a+window,sampleCount),absolute=sourceStart+a,anchor=Math.floor(absolute/sampleRate),file=`audio-${a}.wav`;
    await runProcess(ffmpeg(),[...common,'-ss',String(anchor),'-i',asset.path,'-vn','-af',`aresample=${sampleRate},atrim=start_sample=${absolute-anchor*sampleRate}:end_sample=${sourceStart+b-anchor*sampleRate},areverse,asetpts=N/SR/TB`,'-ac','2','-c:a','pcm_s16le',path.join(temporary,file)],{signal:options.signal});
    audios.unshift(file);options.onProgress?.(.7+.15*b/sampleCount);
   }
  }
  await fs.writeFile(path.join(temporary,'video.txt'),videos.map(file=>`file '${file}'`).join('\n'));
  const args=[...common,'-f','concat','-safe','0','-i',path.join(temporary,'video.txt')];
  if(audios.length){await fs.writeFile(path.join(temporary,'audio.txt'),audios.map(file=>`file '${file}'`).join('\n'));args.push('-f','concat','-safe','0','-i',path.join(temporary,'audio.txt'),'-map','0:v:0','-map','1:a:0','-af','apad','-c:a','aac','-b:a','192k');}
  const file=path.join(directory,'reverse.mp4');args.push('-t',seconds(total/fps),'-r',rate,'-c:v','libx264','-preset','fast','-crf','12','-pix_fmt','yuv420p','-movflags','+faststart','-progress','pipe:1',file);
  await runProcess(ffmpeg(),args,{signal:options.signal,timeout:600000,onLine:line=>{const m=/^out_time_us=(\d+)$/.exec(line);if(m)options.onProgress?.(.85+.15*Math.min(1,Number(m[1])/1e6/(total/fps)));}});
  active(options.signal);return file;
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
