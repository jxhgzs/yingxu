import type {Layer} from '../../../../packages/media/src/graph.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';
import {parseCurveWav} from './curve-pcm.ts';
import type {CurvePcm} from './curve-pcm.ts';

export type CurveAudioContext={projectId:string;revision:number};
export type CurveAudioDescriptor={url:string;key:string;clipId:string;revision:number;duration:number;sampleRate:number;sampleCount:number};
export type CurveAudioProvider=(clipId:string,context:CurveAudioContext,signal:AbortSignal)=>Promise<CurveAudioDescriptor>;
export const CURVE_PCM_MAX_BYTES=32*1024*1024;
export const CURVE_PCM_CACHE_BYTES=64*1024*1024;
const aborted=()=>new DOMException('Aborted','AbortError');
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);

/** PCM cache only: parsing/seeking does not construct an AudioContext. Active
 * AudioBuffer routes own a second copy, bounded separately by this same active set. */
export class CurveSounds{
 private entries=new Map<string,{pcm:CurvePcm;used:number;identity:string}>();private epoch=0;private queue:Promise<unknown>=Promise.resolve();
 private provider:CurveAudioProvider;private onEvict:(id:string)=>void;
 constructor(provider:CurveAudioProvider,onEvict:(id:string)=>void=()=>{}){this.provider=provider;this.onEvict=onEvict;}
 get bytes(){return [...this.entries.values()].reduce((sum,e)=>sum+e.pcm.bytes,0);}
 get size(){return this.entries.size;}
 get(id:string){const e=this.entries.get(id);if(e)e.used=performance.now();return e?.pcm;}
 private remove(id:string){this.onEvict(id);this.entries.delete(id);}
 clear(){this.epoch++;for(const id of this.entries.keys())this.remove(id);}
 async prepare(layer:Layer,context:CurveAudioContext,signal:AbortSignal,activeIds=new Set([layer.clip.id])):Promise<CurvePcm>{
  const epoch=this.epoch,operation=this.queue.catch(()=>{}).then(()=>this.load(layer,context,signal,activeIds,epoch));this.queue=operation;return operation;
 }
 private async load(layer:Layer,context:CurveAudioContext,signal:AbortSignal,activeIds:Set<string>,epoch:number):Promise<CurvePcm>{
  if(signal.aborted||epoch!==this.epoch)throw aborted();
  const identity=JSON.stringify({context,assetId:layer.asset.id,sha256:layer.asset.sha256,source:layer.clip.source,target:layer.clip.target,curve:layer.clip.speedCurve});
  const found=this.entries.get(layer.clip.id);if(found?.identity===identity){found.used=performance.now();return found.pcm;}if(found)this.remove(layer.clip.id);
  const seconds=toNumber(layer.clip.target.duration);
  if(!layer.clip.speedCurve||!finite(seconds)||seconds<=0||Math.ceil(seconds*44100)*8>CURVE_PCM_MAX_BYTES)throw Error('GPU_CURVE_AUDIO_SIZE_LIMIT');
  const reserve=Math.ceil(seconds*44100)*8;
  for(const [id]of [...this.entries.entries()].sort((a,b)=>a[1].used-b[1].used))if(this.bytes+reserve>CURVE_PCM_CACHE_BYTES&&!activeIds.has(id))this.remove(id);
  if(this.bytes+reserve>CURVE_PCM_CACHE_BYTES)throw Error('GPU_CURVE_AUDIO_CACHE_LIMIT');
  const descriptor=await this.provider(layer.clip.id,context,signal);if(signal.aborted||epoch!==this.epoch)throw aborted();
  if(!descriptor||descriptor.clipId!==layer.clip.id||descriptor.revision!==context.revision||!/^[a-f0-9]{64}$/.test(descriptor.key)||descriptor.sampleRate!==44100||!Number.isSafeInteger(descriptor.sampleCount)||descriptor.sampleCount<=0||descriptor.sampleCount*8>CURVE_PCM_MAX_BYTES||Math.abs(descriptor.sampleCount-seconds*44100)>1.1||!finite(descriptor.duration)||Math.abs(descriptor.duration-descriptor.sampleCount/44100)>1e-9)throw Error('GPU_CURVE_AUDIO_DESCRIPTOR_INVALID');
  let url:URL;try{url=new URL(descriptor.url,globalThis.location?.href);}catch{throw Error('GPU_CURVE_AUDIO_URL_INVALID');}
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!==`/curve-audio/${descriptor.key}.wav`)throw Error('GPU_CURVE_AUDIO_URL_INVALID');
  const response=await fetch(url.href,{signal});if(!response.ok||!response.body)throw Error('GPU_CURVE_AUDIO_FETCH_FAILED');
  const maxBytes=CURVE_PCM_MAX_BYTES+65536,advertised=Number(response.headers.get('content-length'));
  if(advertised>maxBytes){await response.body.cancel();throw Error('GPU_CURVE_AUDIO_SIZE_LIMIT');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;if(signal.aborted||epoch!==this.epoch)throw aborted();length+=value.byteLength;if(length>maxBytes)throw Error('GPU_CURVE_AUDIO_SIZE_LIMIT');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(signal.aborted||epoch!==this.epoch)throw aborted();const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const pcm=parseCurveWav(bytes.buffer,{sampleRate:descriptor.sampleRate,sampleCount:descriptor.sampleCount});
  for(const [id]of [...this.entries.entries()].sort((a,b)=>a[1].used-b[1].used))if(this.bytes+pcm.bytes>CURVE_PCM_CACHE_BYTES&&!activeIds.has(id))this.remove(id);
  if(this.bytes+pcm.bytes>CURVE_PCM_CACHE_BYTES)throw Error('GPU_CURVE_AUDIO_CACHE_LIMIT');
  this.entries.set(layer.clip.id,{pcm,used:performance.now(),identity});return pcm;
 }
}
