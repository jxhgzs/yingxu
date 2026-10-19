import fs from 'node:fs/promises';
import path from 'node:path';
import {check} from '../../core/src/document.ts';
import type {Asset,Clip} from '../../core/src/document.ts';
import {renderCurveAudio} from './curve-audio.ts';
import {runProcess} from './process.ts';
import {ffmpeg,ffprobe} from './probe.ts';

export const CURVE_AUDIO_RATE=44100;
export const CURVE_AUDIO_MAX_BYTES=256*1024*1024;
/** Validate the actual data payload as well as ffprobe's stream metadata. */
export async function inspectPreviewCurveAudio(file:string,signal?:AbortSignal){
 const bytes=await fs.readFile(file);check(bytes.length>=44&&bytes.length<=CURVE_AUDIO_MAX_BYTES&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE','CURVE_AUDIO_CACHE_INVALID');
 let format=false,data:Buffer|undefined;
 for(let at=12;at+8<=bytes.length;){const name=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8;check(start+size<=bytes.length,'CURVE_AUDIO_CACHE_INVALID');
  if(name==='fmt '){check(size>=16,'CURVE_AUDIO_CACHE_INVALID');const kind=bytes.readUInt16LE(start);format=(kind===3||kind===65534&&size>=40&&bytes.readUInt16LE(start+24)===3)&&bytes.readUInt16LE(start+2)===2&&bytes.readUInt32LE(start+4)===CURVE_AUDIO_RATE&&bytes.readUInt16LE(start+12)===8&&bytes.readUInt16LE(start+14)===32;}
  if(name==='data'){check(!data,'CURVE_AUDIO_CACHE_INVALID');data=bytes.subarray(start,start+size);}at=start+size+(size%2);
 }
 check(format&&data&&data.length>0&&data.length%8===0,'CURVE_AUDIO_CACHE_INVALID');
 for(let at=0;at<data.length;at+=4)check(Number.isFinite(data.readFloatLE(at)),'CURVE_AUDIO_CACHE_INVALID');
 const sampleCount=data.length/8,result=await runProcess(ffprobe(),['-v','error','-show_streams','-of','json',file],{signal,timeout:30000});const streams=JSON.parse(result.stdout).streams;
 check(streams?.length===1&&streams[0].codec_name==='pcm_f32le'&&Number(streams[0].sample_rate)===CURVE_AUDIO_RATE&&streams[0].channels===2&&streams[0].time_base===`1/${CURVE_AUDIO_RATE}`&&Number(streams[0].duration_ts)===sampleCount,'CURVE_AUDIO_CACHE_INVALID');
 return {bytes,sampleCount,sampleRate:CURVE_AUDIO_RATE,duration:sampleCount/CURVE_AUDIO_RATE};
}
/** Neutral target-clock audio: gain, source-clock keyframes and fades stay live in Web Audio. */
export async function renderPreviewCurveAudio(asset:Asset,clip:Clip,directory:string,options:{signal?:AbortSignal;engine?:{binary:string;sha256:string}}={}){
 const rendered=await renderCurveAudio(asset,clip,directory,{sampleRate:CURVE_AUDIO_RATE,signal:options.signal,...(options.engine?{engine:options.engine}:{})});
 const output=path.join(directory,'preview.wav');
 await runProcess(ffmpeg(),['-hide_banner','-loglevel','error','-nostdin','-y','-i',rendered.path,'-map','0:a:0','-ar',String(CURVE_AUDIO_RATE),'-ac','2','-c:a','pcm_f32le',output],{signal:options.signal,timeout:1800000});
 const inspected=await inspectPreviewCurveAudio(output,options.signal);check(inspected.sampleCount===rendered.sampleCount,'CURVE_AUDIO_LENGTH_MISMATCH');return {path:output,...inspected};
}
