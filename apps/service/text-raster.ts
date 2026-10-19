import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {Store,contentHash,atomicJSON} from './store.ts';
import {renderGraph} from '../../packages/media/src/graph.ts';
import {rasterTextFrames} from '../../packages/media/src/text-raster-batch.ts';
import type {Layer,RenderGraph} from '../../packages/media/src/graph.ts';
import {rasterText} from '../../packages/media/src/text-raster.ts';
import {check,defaultTransform} from '../../packages/core/src/document.ts';
import {sourceTimeAt,evaluateAnimation} from '../../packages/core/src/animation.ts';
import {textAnimationState,textAnimationVisibleCount,textAnimationGlyphState,textAnimationLetterOpacities,textAnimationOffsetY} from '../../packages/core/src/text-animation.ts';
import {add,sub,compare,div,rational} from '../../packages/core/src/time.ts';

export function systemFontEnvironmentIdentity(){return {platform:os.platform(),release:os.release(),version:os.version(),arch:os.arch()};}
type PreparationLease={id:symbol;projectId:string;revision:number;keys:Set<string>;controller:AbortController};
export type TextPreparation={projectId:string;revision:number;status:'ready'|'partial';requested:number;completed:number;uniqueTextures:number;bytes:number;elapsedMs:number;reason?:'cache-budget'};
type TextRequest={revision:number;clipId:string;mode?:TextRasterMode;frame?:number};
export type TextRasterMode='neutral'|'frame';
export type TextTexture={url:string;key:string;clipId:string;revision:number;width:number;height:number;mode?:TextRasterMode;frame?:number};
/** Demand-only serial raster queue. Completed textures are content addressed; HTTP cancellation kills its own child. */
export class TextRasters{
 private queue:Promise<unknown>=Promise.resolve();private closing=false;private controllers=new Set<AbortController>();
 private store:Store;private options:{engine:string};private lease?:PreparationLease;private cacheLimits:{files:number;bytes:number};private pending=0;private fontEnvironment=systemFontEnvironmentIdentity();
 constructor(store:Store,options:{engine:string;cacheLimits?:{files:number;bytes:number}}){this.store=store;this.options=options;this.cacheLimits=options.cacheLimits??{files:512,bytes:268435456};check(Number.isSafeInteger(this.cacheLimits.files)&&this.cacheLimits.files>0&&Number.isSafeInteger(this.cacheLimits.bytes)&&this.cacheLimits.bytes>0,'INVALID_TEXT_CACHE_LIMIT');}
 private directory(){return path.join(this.store.root,'text-renders');}
 async file(key:string){check(/^[a-f0-9]{64}$/.test(key),'INVALID_TEXT_TEXTURE_KEY');const file=path.join(this.directory(),key+'.png');
  const stat=await fs.lstat(file);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=134217728,'TEXT_TEXTURE_CACHE_INVALID');
  const record=JSON.parse(await fs.readFile(path.join(this.directory(),key+'.json'),'utf8'));
  check(record.key===key&&record.bytes===stat.size&&record.sha256===createHash('sha256').update(await fs.readFile(file)).digest('hex'),'TEXT_TEXTURE_CACHE_INVALID');return file;}
 private describe(projectId:string,body:TextRequest){
  check(!this.closing,'SERVICE_CLOSING');check(this.pending<32,'TEXT_TEXTURE_QUEUE_LIMIT');check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>['revision','clipId','mode','frame'].includes(k))&&Number.isSafeInteger(body.revision)&&body.revision>=0&&typeof body.clipId==='string'&&body.clipId.length>0&&body.clipId.length<=200,'INVALID_TEXT_TEXTURE_REQUEST');
  check((body.mode===undefined||body.mode==='neutral'||body.mode==='frame')&&(body.mode==='frame'?Number.isSafeInteger(body.frame)&&body.frame!>=0:body.frame===undefined),'INVALID_TEXT_TEXTURE_REQUEST');
  const project=this.store.get(projectId);check(project.revision===body.revision,'REVISION_CONFLICT');check(project.diagnostics.length===0,'UNSUPPORTED_DRAFT_EFFECTS');
  if(this.lease?.projectId===projectId&&this.lease.revision!==project.revision){this.lease.controller.abort();this.lease=undefined;}
  const graph=renderGraph(project.document),layer=graph.layers.find(l=>l.clip.id===body.clipId);check(layer?.asset.kind==='text','TEXT_RASTER_CLIP_REQUIRED');
  check((body.mode!==undefined||!layer.clip.animations?.some(a=>a.property!=='volume')&&!layer.clip.textAnimations?.length)&&!layer.clip.speedCurve,'TEXT_RASTER_ANIMATION_UNSUPPORTED');
  return {graph,layer,result:this.descriptor(graph,layer,body)};
 }
 private descriptor(graph:RenderGraph,layer:Layer,body:TextRequest):TextTexture{
  if(body.mode==='frame'){const frameTime=div(rational(body.frame!),graph.document.fps);check(compare(frameTime,layer.clip.target.start)>=0&&compare(frameTime,add(layer.clip.target.start,layer.clip.target.duration))<0,'TEXT_RASTER_FRAME_OUTSIDE_CLIP');}
  let renderIdentity:unknown={text:layer.clip.text,transform:layer.clip.transform};
  if(body.mode==='neutral')renderIdentity={mode:body.mode,text:layer.clip.text};
  if(body.mode==='frame'){
   const at=div(rational(body.frame!),graph.document.fps),source=sourceTimeAt(layer.clip,at),transform={...(layer.clip.transform||defaultTransform())};
   for(const animation of layer.clip.animations||[])if(animation.property!=='volume')transform[animation.property]=evaluateAnimation(animation,source);
   if(layer.clip.textAnimations?.some(a=>a.kind==='bounce')){const offset=textAnimationOffsetY(layer.clip.textAnimations,sub(at,layer.clip.target.start),layer.clip.target.duration,graph.document.fps,layer.clip.target.start)*Math.max(graph.document.canvas.width,graph.document.canvas.height)*transform.scale,angle=transform.rotation*Math.PI/180;transform.x-=Math.sin(angle)*offset;transform.y+=Math.cos(angle)*offset;}
   const preset=textAnimationState(layer.clip.textAnimations,sub(at,layer.clip.target.start),layer.clip.target.duration);transform.opacity*=preset.opacity;transform.scale*=preset.scale;
   const baseOpacity=transform.opacity,letterOpacity=textAnimationLetterOpacities(layer.clip.textAnimations,layer.clip.text!.content,sub(at,layer.clip.target.start));
   const letterAlphas=letterOpacity?.map(relative=>1-Math.round((1-baseOpacity*relative)*255)/255);
   transform.opacity=1-Math.round((1-baseOpacity)*255)/255;
   const typewriter=layer.clip.textAnimations?.find(a=>a.kind==='typewriter'),visibleCount=typewriter?textAnimationVisibleCount(typewriter,layer.clip.text!.content,sub(at,layer.clip.target.start)):undefined;
   const glyphState=layer.clip.textAnimations?.some(a=>a.kind==='sway')?textAnimationGlyphState(layer.clip.textAnimations,sub(at,layer.clip.target.start),layer.clip.target.duration):undefined;
   renderIdentity={mode:body.mode,text:layer.clip.text,transform,visibleCount,glyphState,...(letterAlphas?{letterAlphas}:{}),animated:!!layer.clip.animations?.some(a=>a.property!=='volume')||!!layer.clip.textAnimations?.length};
  }
  const key=contentHash({version:body.mode?'libass-animation-rgba-v1':'libass-static-rgba-v1',engine:this.options.engine,fontEnvironment:this.fontEnvironment,canvas:graph.document.canvas,renderIdentity});
  const result:TextTexture={key,url:`/text-renders/${key}.png`,clipId:body.clipId,revision:body.revision,...graph.document.canvas,...(body.mode?{mode:body.mode}:{}),...(body.mode==='frame'?{frame:body.frame}:{})};
  return result;
 }
 async request(projectId:string,body:TextRequest,signal?:AbortSignal):Promise<TextTexture>{
  const {graph,layer,result}=this.describe(projectId,body),key=result.key;
  const controller=new AbortController(),cancel=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',cancel,{once:true});this.controllers.add(controller);this.pending++;
  const task=this.queue.catch(()=>{}).then(async()=>{
   check(!this.closing,'SERVICE_CLOSING');if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
   // A queued request must still belong to the captured revision, not silently raster a newer document.
   const current=()=>{if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');check(this.store.get(projectId).revision===body.revision,'REVISION_CONFLICT');};current();
   try{await this.file(key);current();return result;}catch(error:any){if(error.code!=='ENOENT')throw error;}
   await fs.mkdir(this.directory(),{recursive:true});const temporary=path.join(this.directory(),'.'+randomUUID()),target=path.join(this.directory(),key+'.png'),record=path.join(this.directory(),key+'.json');let published=false;
   try{const rendered=await rasterText(layer,graph.document.canvas,temporary,{signal:controller.signal,...(body.mode?{mode:body.mode}:{}),...(body.mode==='frame'?{frame:body.frame,fps:graph.document.fps}:{})});current();
    const bytes=await fs.readFile(rendered.path);check(bytes.length<=134217728,'TEXT_RASTER_SIZE_LIMIT');current();
    await fs.rename(rendered.path,target);published=true;current();await atomicJSON(record,{key,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:result.width,height:result.height,engine:this.options.engine,fontEnvironment:this.fontEnvironment});
    current();await this.prune(key);current();return result;
   }catch(error){if(published){await fs.rm(target,{force:true});await fs.rm(record,{force:true});}if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');throw error;}finally{await fs.rm(temporary,{recursive:true,force:true});}
  });
  this.queue=task;try{return await task;}finally{signal?.removeEventListener('abort',cancel);this.controllers.delete(controller);this.pending--;}
 }
 async batch(projectId:string,body:{revision:number;clipId:string;frames:number[]},signal?:AbortSignal,reservation?:PreparationLease):Promise<{revision:number;clipId:string;mode:'frame';textures:TextTexture[]}>{
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>['revision','clipId','frames'].includes(k))&&Array.isArray(body.frames)&&body.frames.length>0&&body.frames.length<=32&&body.frames.every((f,i)=>Number.isSafeInteger(f)&&f>=0&&(!i||f>body.frames[i-1]))&&body.frames.at(-1)!-body.frames[0]<300,'INVALID_TEXT_TEXTURE_BATCH');
  const first=this.describe(projectId,{revision:body.revision,clipId:body.clipId,mode:'frame',frame:body.frames[0]}),{graph,layer}=first;
  check(graph.document.canvas.width*graph.document.canvas.height<=1920*1080&&graph.document.canvas.width*graph.document.canvas.height*4*body.frames.length<=128*1024*1024,'TEXT_RASTER_BATCH_SIZE_LIMIT');
  const textures=body.frames.map(frame=>this.descriptor(graph,layer,{revision:body.revision,clipId:body.clipId,mode:'frame',frame}));
  const controller=new AbortController(),cancel=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',cancel,{once:true});this.controllers.add(controller);this.pending++;
  const current=()=>{if(reservation&&this.lease!==reservation)throw new DOMException('Aborted','AbortError');check(!this.closing,'SERVICE_CLOSING');if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');check(this.store.get(projectId).revision===body.revision,'REVISION_CONFLICT');};
  const task=this.queue.catch(()=>{}).then(async()=>{
   current();const missing=new Map<string,TextTexture>();
   for(const texture of textures){try{await this.file(texture.key);}catch(error:any){if(error.code!=='ENOENT')throw error;missing.set(texture.key,missing.get(texture.key)??texture);}current();}
   if(!missing.size){await this.prune(new Set(textures.map(t=>t.key)),reservation);current();return {revision:body.revision,clipId:body.clipId,mode:'frame' as const,textures};}
   const inputs=[...missing.values()].sort((a,b)=>a.frame!-b.frame!),temporary=path.join(this.directory(),'.batch-'+randomUUID()),published=new Set<string>();
   try{await fs.mkdir(this.directory(),{recursive:true});const rendered=await rasterTextFrames(layer,graph.document.canvas,temporary,{frames:inputs.map(t=>t.frame!),fps:graph.document.fps,signal:controller.signal});current();
    for(let i=0;i<inputs.length;i++){
     current();const texture=inputs[i],bytes=await fs.readFile(rendered[i].path);check(bytes.length<=134217728,'TEXT_RASTER_SIZE_LIMIT');current();
     await fs.rename(rendered[i].path,path.join(this.directory(),texture.key+'.png'));published.add(texture.key);current();
     await atomicJSON(path.join(this.directory(),texture.key+'.json'),{key:texture.key,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:texture.width,height:texture.height,engine:this.options.engine,fontEnvironment:this.fontEnvironment});current();
    }
    await this.prune(new Set(textures.map(t=>t.key)),reservation);current();return {revision:body.revision,clipId:body.clipId,mode:'frame' as const,textures};
   }catch(error){for(const key of published){await fs.rm(path.join(this.directory(),key+'.png'),{force:true});await fs.rm(path.join(this.directory(),key+'.json'),{force:true});}if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');throw error;}finally{await fs.rm(temporary,{recursive:true,force:true});}
  });
  this.queue=task;try{return await task;}finally{signal?.removeEventListener('abort',cancel);this.controllers.delete(controller);this.pending--;}
 }
 async prepare(projectId:string,body:{revision:number;frames:{clipId:string;frame:number}[]},signal?:AbortSignal):Promise<TextPreparation>{
  check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>['revision','frames'].includes(k))&&Number.isSafeInteger(body.revision)&&body.revision>=0&&Array.isArray(body.frames)&&body.frames.length>0&&body.frames.length<=300&&body.frames.every((f,i)=>f&&typeof f==='object'&&!Array.isArray(f)&&Object.keys(f).every(k=>['clipId','frame'].includes(k))&&typeof f.clipId==='string'&&f.clipId.length>0&&f.clipId.length<=200&&Number.isSafeInteger(f.frame)&&f.frame>=0&&(!i||f.frame>=body.frames[i-1].frame))&&new Set(body.frames.map(f=>JSON.stringify([f.clipId,f.frame]))).size===body.frames.length&&body.frames.at(-1)!.frame-body.frames[0].frame<300,'INVALID_TEXT_PREPARATION_REQUEST');
  const started=performance.now(),firstFrame=body.frames[0],{graph}=this.describe(projectId,{revision:body.revision,clipId:firstFrame.clipId,mode:'frame',frame:firstFrame.frame}),groups=new Map<string,number[]>();
  check(graph.document.canvas.width*graph.document.canvas.height<=1920*1080,'TEXT_RASTER_BATCH_SIZE_LIMIT');
  for(const f of body.frames){const layer=graph.layers.find(l=>l.clip.id===f.clipId);check(layer?.asset.kind==='text'&&!layer.clip.speedCurve,'TEXT_RASTER_CLIP_REQUIRED');this.descriptor(graph,layer,{revision:body.revision,clipId:f.clipId,mode:'frame',frame:f.frame});const frames=groups.get(f.clipId)??[];frames.push(f.frame);groups.set(f.clipId,frames);}
  const capacity=Math.min(32,this.cacheLimits.files,Math.floor(128*1024*1024/(graph.document.canvas.width*graph.document.canvas.height*4))),windows=[...groups].flatMap(([clipId,frames])=>Array.from({length:Math.ceil(frames.length/Math.max(1,capacity))},(_,i)=>({clipId,frames:frames.slice(i*capacity,(i+1)*capacity)})));
  const controller=new AbortController(),cancel=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',cancel,{once:true});
  if(controller.signal.aborted){signal?.removeEventListener('abort',cancel);throw new DOMException('Aborted','AbortError');}
  this.lease?.controller.abort();const lease:PreparationLease={id:Symbol(),projectId,revision:body.revision,keys:new Set(),controller};this.lease=lease;this.controllers.add(controller);
  const current=()=>{if(controller.signal.aborted||this.lease!==lease)throw new DOMException('Aborted','AbortError');check(!this.closing,'SERVICE_CLOSING');check(this.store.get(projectId).revision===body.revision,'REVISION_CONFLICT');};
  let completed=0,bytes=0,status:'ready'|'partial'='ready';
  try{for(const {clipId,frames}of windows){current();
    if(!frames.length){status='partial';break;}
    try{const batch=await this.batch(projectId,{revision:body.revision,clipId,frames},controller.signal,lease);current();for(const texture of batch.textures)lease.keys.add(texture.key);completed+=frames.length;
     bytes=0;for(const key of lease.keys){current();const file=await this.file(key);bytes+=(await fs.stat(file)).size;await fs.utimes(file,new Date(),new Date());}current();
    }catch(error){if((error as Error).message==='TEXT_PREPARE_CACHE_BUDGET'){status='partial';break;}throw error;}
   }current();return {projectId,revision:body.revision,status,requested:body.frames.length,completed,uniqueTextures:lease.keys.size,bytes,elapsedMs:performance.now()-started,...(status==='partial'?{reason:'cache-budget' as const}:{})};
  }catch(error){if(this.lease===lease)this.lease=undefined;if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');throw error;}
  finally{signal?.removeEventListener('abort',cancel);this.controllers.delete(controller);}
 }
 private async prune(keep:string|ReadonlySet<string>,reservation?:PreparationLease){
  const entries=await fs.readdir(this.directory()),files=[] as {key:string;bytes:number;mtime:number}[];
  for(const name of entries)if(/^[a-f0-9]{64}\.png$/.test(name)){const key=name.slice(0,-4),stat=await fs.lstat(path.join(this.directory(),name));if(stat.isFile())files.push({key,bytes:stat.size,mtime:stat.mtimeMs});}
  const protectedKeys=new Set(typeof keep==='string'?[keep]:keep);for(const key of this.lease?.keys??[])protectedKeys.add(key);
  const protectedFiles=files.filter(f=>protectedKeys.has(f.key));if(protectedFiles.length>this.cacheLimits.files||protectedFiles.reduce((n,f)=>n+f.bytes,0)>this.cacheLimits.bytes){
   if(reservation)throw Error('TEXT_PREPARE_CACHE_BUDGET');this.lease?.controller.abort();this.lease=undefined;protectedKeys.clear();for(const key of typeof keep==='string'?[keep]:keep)protectedKeys.add(key);
   const required=files.filter(f=>protectedKeys.has(f.key));check(required.length<=this.cacheLimits.files&&required.reduce((n,f)=>n+f.bytes,0)<=this.cacheLimits.bytes,'TEXT_PREPARE_CACHE_BUDGET');
  }
  files.sort((a,b)=>b.mtime-a.mtime);let bytes=files.reduce((n,f)=>n+f.bytes,0),count=files.length;
  for(const file of files.reverse())if(!protectedKeys.has(file.key)&&(count>this.cacheLimits.files||bytes>this.cacheLimits.bytes)){await fs.rm(path.join(this.directory(),file.key+'.png'),{force:true});await fs.rm(path.join(this.directory(),file.key+'.json'),{force:true});bytes-=file.bytes;count--;}
 }
 async shutdown(){this.closing=true;this.lease?.controller.abort();this.lease=undefined;for(const c of this.controllers)c.abort();await this.queue.catch(()=>{});}
}
