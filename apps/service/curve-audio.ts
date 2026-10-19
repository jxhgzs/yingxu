import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Store,contentHash,atomicJSON} from './store.ts';
import {renderGraph} from '../../packages/media/src/graph.ts';
import {inspectPreviewCurveAudio,renderPreviewCurveAudio,CURVE_AUDIO_RATE,CURVE_AUDIO_MAX_BYTES} from '../../packages/media/src/preview-curve-audio.ts';
import {fileHash} from '../../packages/media/src/probe.ts';
import {check} from '../../packages/core/src/document.ts';
import {toNumber} from '../../packages/core/src/time.ts';
import {curveSourceDelta} from '../../packages/core/src/curve-speed.ts';

export type CurveAudioRender={url:string;key:string;clipId:string;revision:number;duration:number;sampleRate:number;sampleCount:number};
const cancelled=()=>new DOMException('Aborted','AbortError');
/** Serial, bounded, content-addressed sidecar queue. This never registers a new user asset. */
export class CurveAudioRenders{
 private queue:Promise<unknown>=Promise.resolve();private closing=false;private controllers=new Set<AbortController>();private pending=0;
 private store:Store;private options:{engine:string};private binary:string;private identity?:Promise<{binary:string;sha256:string}>;private binaryStat?:{size:number;mtimeMs:number;ctimeMs:number};
 constructor(store:Store,options:{engine:string}){this.store=store;this.options=options;this.binary=process.env.YINGXU_RUBBERBAND||'/opt/homebrew/bin/rubberband';}
 private directory(){return path.join(this.store.root,'curve-audio');}
 private async engine(){const identity=await (this.identity??=(async()=>{let sha256:string;try{const stat=await fs.stat(this.binary);this.binaryStat={size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs};sha256=await fileHash(this.binary);}catch{throw Error('CURVE_AUDIO_ENGINE_UNAVAILABLE');}return {binary:this.binary,sha256};})());const stat=await fs.stat(this.binary);check(stat.size===this.binaryStat!.size&&stat.mtimeMs===this.binaryStat!.mtimeMs&&stat.ctimeMs===this.binaryStat!.ctimeMs,'CURVE_AUDIO_ENGINE_CHANGED');return identity;}
 async file(key:string){return (await this.cached(key)).file;}
 private async cached(key:string,signal?:AbortSignal){check(/^[a-f0-9]{64}$/.test(key),'INVALID_CURVE_AUDIO_KEY');const file=path.join(this.directory(),key+'.wav'),recordFile=path.join(this.directory(),key+'.json');
  const [stat,recordStat]=await Promise.all([fs.lstat(file),fs.lstat(recordFile)]);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=CURVE_AUDIO_MAX_BYTES&&recordStat.isFile()&&!recordStat.isSymbolicLink()&&recordStat.size<=16384,'CURVE_AUDIO_CACHE_INVALID');
  const record=JSON.parse(await fs.readFile(recordFile,'utf8')),info=await inspectPreviewCurveAudio(file,signal);
  check(record.key===key&&record.bytes===stat.size&&record.sha256===createHash('sha256').update(info.bytes).digest('hex')&&record.sampleCount===info.sampleCount&&record.sampleRate===info.sampleRate&&record.duration===info.duration,'CURVE_AUDIO_CACHE_INVALID');return {file,info};
 }
 async request(projectId:string,body:{revision:number;clipId:string},signal?:AbortSignal):Promise<CurveAudioRender>{
  check(!this.closing,'SERVICE_CLOSING');check(this.pending<32,'CURVE_AUDIO_QUEUE_LIMIT');
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>k==='revision'||k==='clipId')&&Number.isSafeInteger(body.revision)&&body.revision>=0&&typeof body.clipId==='string'&&body.clipId.length>0&&body.clipId.length<=200,'INVALID_CURVE_AUDIO_REQUEST');
  const project=this.store.get(projectId);check(project.revision===body.revision,'REVISION_CONFLICT');check(project.diagnostics.length===0,'UNSUPPORTED_DRAFT_EFFECTS');
  const graph=renderGraph(project.document),layer=graph.audio.find(l=>l.clip.id===body.clipId);check(layer?.clip.speedCurve,'CURVE_AUDIO_AUDIBLE_CURVE_REQUIRED');
  const registered=this.store.assets.get(layer.asset.id);check(registered&&registered.path===layer.asset.path&&registered.sha256===layer.asset.sha256&&/^[a-f0-9]{64}$/.test(registered.sha256||''),'MEDIA_NOT_LINKED');
  const seconds=toNumber(layer.clip.target.duration),sourceSeconds=toNumber(curveSourceDelta(layer.clip.speedCurve,layer.clip.source.duration,layer.clip.target.duration,layer.clip.target.duration));check(seconds<=600&&[seconds,sourceSeconds].every(value=>Math.ceil(value*CURVE_AUDIO_RATE)*8+4096<=CURVE_AUDIO_MAX_BYTES),'CURVE_AUDIO_PREVIEW_LIMIT');
  const asset=structuredClone(registered),clip=structuredClone(layer.clip),revision=body.revision,clipId=body.clipId;
  const controller=new AbortController(),cancel=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',cancel,{once:true});this.controllers.add(controller);this.pending++;
  const task=this.queue.catch(()=>{}).then(async()=>{
   check(!this.closing,'SERVICE_CLOSING');if(controller.signal.aborted)throw cancelled();check(this.store.get(projectId).revision===revision,'REVISION_CONFLICT');
   const current=this.store.assets.get(asset.id);check(current&&current.path===asset.path&&current.sha256===asset.sha256,'MEDIA_NOT_LINKED');check(await fileHash(asset.path)===asset.sha256,'MEDIA_HASH_CHANGED');
   if(controller.signal.aborted)throw cancelled();const engine=await this.engine();
   const key=contentHash({version:'neutral-curve-audio-r3-f32-v1',engine:this.options.engine,rubberband:engine,projectId,revision,clipId,asset:{id:asset.id,sha256:asset.sha256},source:clip.source,targetDuration:clip.target.duration,speed:clip.speed,speedCurve:clip.speedCurve,sampleRate:CURVE_AUDIO_RATE});
   const make=(info:{duration:number;sampleRate:number;sampleCount:number}):CurveAudioRender=>({key,url:`/curve-audio/${key}.wav`,clipId,revision,duration:info.duration,sampleRate:info.sampleRate,sampleCount:info.sampleCount});
   try{const {info}=await this.cached(key,controller.signal);if(controller.signal.aborted)throw cancelled();check(this.store.get(projectId).revision===revision,'REVISION_CONFLICT');return make(info);}catch(error:any){if(error.code!=='ENOENT')throw error;}
   await fs.mkdir(this.directory(),{recursive:true});const temporary=path.join(this.directory(),'.'+randomUUID());let committed=false;
   try{const rendered=await renderPreviewCurveAudio(asset,clip,temporary,{signal:controller.signal,engine});if(controller.signal.aborted)throw cancelled();check(this.store.get(projectId).revision===revision,'REVISION_CONFLICT');
    await this.engine();check(rendered.bytes.length<=CURVE_AUDIO_MAX_BYTES,'CURVE_AUDIO_PREVIEW_LIMIT');await fs.rename(rendered.path,path.join(this.directory(),key+'.wav'));
    await atomicJSON(path.join(this.directory(),key+'.json'),{key,bytes:rendered.bytes.length,sha256:createHash('sha256').update(rendered.bytes).digest('hex'),sampleCount:rendered.sampleCount,sampleRate:rendered.sampleRate,duration:rendered.duration,engine:this.options.engine,rubberband:engine});
    await this.prune(key);if(controller.signal.aborted)throw cancelled();check(this.store.get(projectId).revision===revision,'REVISION_CONFLICT');committed=true;return make(rendered);
   }finally{if(!committed){await fs.rm(path.join(this.directory(),key+'.wav'),{force:true});await fs.rm(path.join(this.directory(),key+'.json'),{force:true});}await fs.rm(temporary,{recursive:true,force:true});}
  });this.queue=task;
  try{return await task;}finally{signal?.removeEventListener('abort',cancel);this.controllers.delete(controller);this.pending--;}
 }
 private async prune(keep:string){
  const files=[] as {key:string;bytes:number;mtime:number}[];for(const name of await fs.readdir(this.directory()))if(/^[a-f0-9]{64}\.wav$/.test(name)){const stat=await fs.lstat(path.join(this.directory(),name));if(stat.isFile()&&!stat.isSymbolicLink())files.push({key:name.slice(0,-4),bytes:stat.size,mtime:stat.mtimeMs});}
  files.sort((a,b)=>a.mtime-b.mtime);let bytes=files.reduce((n,f)=>n+f.bytes,0),count=files.length;
  for(const file of files)if(file.key!==keep&&(count>32||bytes>512*1024*1024)){await fs.rm(path.join(this.directory(),file.key+'.wav'),{force:true});await fs.rm(path.join(this.directory(),file.key+'.json'),{force:true});bytes-=file.bytes;count--;}
 }
 async shutdown(){this.closing=true;for(const controller of this.controllers)controller.abort();await this.queue.catch(()=>{});}
}
