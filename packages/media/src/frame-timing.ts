import {spawn} from 'node:child_process';
import {ffprobe} from './probe.ts';
import {compare,mul,rational} from '../../core/src/time.ts';
import type {Asset} from '../../core/src/document.ts';

/** A bounded proof of every decoded CFR30 PTS, not an average-rate guess. */
export async function detectCfr30(asset:Asset,options:{signal?:AbortSignal}={}):Promise<'cfr30'|undefined>{
 if(asset.kind!=='video'||!asset.fps||compare(asset.fps,rational(30))!==0||compare(asset.duration,rational(300))>0)return undefined;
 const expected=mul(asset.duration,rational(30));
 if(expected.denominator!=='1'||BigInt(expected.numerator)<1n||BigInt(expected.numerator)>9000n)return undefined;
 if(options.signal?.aborted)throw Error('JOB_CANCELLED');
 const text=await new Promise<string|undefined>((resolve,reject)=>{
  const child=spawn(ffprobe(),['-v','error','-select_streams','v:0','-read_intervals','%+#9001','-show_entries','stream=time_base,duration_ts:frame=pts,pkt_duration','-of','json',asset.path],{stdio:['ignore','pipe','pipe']});
  let bytes=0,stdout='',stderrBytes=0,limited=false,cancelled=false;const stop=()=>{limited=true;child.kill('SIGKILL');};
  const cancel=()=>{cancelled=true;child.kill('SIGKILL');};options.signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(stop,20000),finish=(result:string|undefined)=>{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);if(cancelled)reject(Error('JOB_CANCELLED'));else resolve(result);};
  child.stdout.setEncoding('utf8');child.stdout.on('data',(part:string)=>{bytes+=Buffer.byteLength(part);if(bytes>2_000_000)stop();else stdout+=part;});
  child.stderr.on('data',(part:Buffer)=>{stderrBytes+=part.length;if(stderrBytes>32000)stop();});
  child.on('error',()=>finish(undefined));child.on('close',code=>finish(code===0&&!limited?stdout:undefined));
 });
 if(options.signal?.aborted)throw Error('JOB_CANCELLED');if(!text)return undefined;
 try{
  const parsed=JSON.parse(text),stream=parsed.streams?.[0],frames=parsed.frames;
  if(!stream||!Array.isArray(frames)||frames.length!==Number(expected.numerator)||frames.length>9000)return undefined;
  const match=String(stream.time_base).match(/^(\d+)\/(\d+)$/);if(!match)return undefined;
  const numerator=BigInt(match[1]),denominator=BigInt(match[2]);if(numerator===0n||denominator===0n)return undefined;
  // Stream starts at zero and ends on the declared last frame; edit clocks assume this origin.
  for(let i=0;i<frames.length;i++){
   const frame=frames[i];if(!Number.isSafeInteger(frame.pts)||BigInt(frame.pts)*numerator*30n!==BigInt(i)*denominator)return undefined;
   if(frame.pkt_duration!==undefined&&(!Number.isSafeInteger(frame.pkt_duration)||BigInt(frame.pkt_duration)*numerator*30n!==denominator))return undefined;
  }
  if(!Number.isSafeInteger(stream.duration_ts)||BigInt(stream.duration_ts)*numerator*30n!==BigInt(frames.length)*denominator)return undefined;
  return 'cfr30';
 }catch{return undefined;}
}
