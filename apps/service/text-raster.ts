import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {Store,contentHash,atomicJSON} from './store.ts';
import {renderGraph} from '../../packages/media/src/graph.ts';
import {rasterText} from '../../packages/media/src/text-raster.ts';
import {check,defaultTransform} from '../../packages/core/src/document.ts';
import {sourceTimeAt,evaluateAnimation} from '../../packages/core/src/animation.ts';
import {textAnimationOpacity,textAnimationVisibleCount} from '../../packages/core/src/text-animation.ts';
import {add,sub,compare,div,rational} from '../../packages/core/src/time.ts';

export function systemFontEnvironmentIdentity(){return {platform:os.platform(),release:os.release(),version:os.version(),arch:os.arch()};}
export type TextRasterMode='neutral'|'frame';
export type TextTexture={url:string;key:string;clipId:string;revision:number;width:number;height:number;mode?:TextRasterMode;frame?:number};
/** Demand-only serial raster queue. Completed textures are content addressed; HTTP cancellation kills its own child. */
export class TextRasters{
 private queue:Promise<unknown>=Promise.resolve();private closing=false;private controllers=new Set<AbortController>();
 private store:Store;private options:{engine:string};private pending=0;private fontEnvironment=systemFontEnvironmentIdentity();
 constructor(store:Store,options:{engine:string}){this.store=store;this.options=options;}
 private directory(){return path.join(this.store.root,'text-renders');}
 async file(key:string){check(/^[a-f0-9]{64}$/.test(key),'INVALID_TEXT_TEXTURE_KEY');const file=path.join(this.directory(),key+'.png');
  const stat=await fs.lstat(file);check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=134217728,'TEXT_TEXTURE_CACHE_INVALID');
  const record=JSON.parse(await fs.readFile(path.join(this.directory(),key+'.json'),'utf8'));
  check(record.key===key&&record.bytes===stat.size&&record.sha256===createHash('sha256').update(await fs.readFile(file)).digest('hex'),'TEXT_TEXTURE_CACHE_INVALID');return file;}
 async request(projectId:string,body:{revision:number;clipId:string;mode?:TextRasterMode;frame?:number},signal?:AbortSignal):Promise<TextTexture>{
  check(!this.closing,'SERVICE_CLOSING');check(this.pending<32,'TEXT_TEXTURE_QUEUE_LIMIT');check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>['revision','clipId','mode','frame'].includes(k))&&Number.isSafeInteger(body.revision)&&body.revision>=0&&typeof body.clipId==='string'&&body.clipId.length>0&&body.clipId.length<=200,'INVALID_TEXT_TEXTURE_REQUEST');
  check((body.mode===undefined||body.mode==='neutral'||body.mode==='frame')&&(body.mode==='frame'?Number.isSafeInteger(body.frame)&&body.frame!>=0:body.frame===undefined),'INVALID_TEXT_TEXTURE_REQUEST');
  const project=this.store.get(projectId);check(project.revision===body.revision,'REVISION_CONFLICT');check(project.diagnostics.length===0,'UNSUPPORTED_DRAFT_EFFECTS');
  const graph=renderGraph(project.document),layer=graph.layers.find(l=>l.clip.id===body.clipId);check(layer?.asset.kind==='text','TEXT_RASTER_CLIP_REQUIRED');
  check((body.mode!==undefined||!layer.clip.animations?.some(a=>a.property!=='volume')&&!layer.clip.textAnimations?.length)&&!layer.clip.speedCurve,'TEXT_RASTER_ANIMATION_UNSUPPORTED');
  if(body.mode==='frame'){const frameTime=div(rational(body.frame!),graph.document.fps);check(compare(frameTime,layer.clip.target.start)>=0&&compare(frameTime,add(layer.clip.target.start,layer.clip.target.duration))<0,'TEXT_RASTER_FRAME_OUTSIDE_CLIP');}
  let renderIdentity:unknown={text:layer.clip.text,transform:layer.clip.transform};
  if(body.mode==='neutral')renderIdentity={mode:body.mode,text:layer.clip.text};
  if(body.mode==='frame'){
   const at=div(rational(body.frame!),graph.document.fps),source=sourceTimeAt(layer.clip,at),transform={...(layer.clip.transform||defaultTransform())};
   for(const animation of layer.clip.animations||[])if(animation.property!=='volume')transform[animation.property]=evaluateAnimation(animation,source);
   transform.opacity*=textAnimationOpacity(layer.clip.textAnimations,sub(at,layer.clip.target.start),layer.clip.target.duration);
   transform.opacity=1-Math.round((1-transform.opacity)*255)/255;
   const typewriter=layer.clip.textAnimations?.find(a=>a.kind==='typewriter'),visibleCount=typewriter?textAnimationVisibleCount(typewriter,layer.clip.text!.content,sub(at,layer.clip.target.start)):undefined;
   renderIdentity={mode:body.mode,text:layer.clip.text,transform,visibleCount,animated:!!layer.clip.animations?.some(a=>a.property!=='volume')||!!layer.clip.textAnimations?.length};
  }
  const key=contentHash({version:body.mode?'libass-animation-rgba-v1':'libass-static-rgba-v1',engine:this.options.engine,fontEnvironment:this.fontEnvironment,canvas:graph.document.canvas,renderIdentity});
  const result:TextTexture={key,url:`/text-renders/${key}.png`,clipId:body.clipId,revision:body.revision,...graph.document.canvas,...(body.mode?{mode:body.mode}:{}),...(body.mode==='frame'?{frame:body.frame}:{})};
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
 private async prune(keep:string){
  const entries=await fs.readdir(this.directory()),files=[] as {key:string;bytes:number;mtime:number}[];
  for(const name of entries)if(/^[a-f0-9]{64}\.png$/.test(name)){const key=name.slice(0,-4),stat=await fs.lstat(path.join(this.directory(),name));if(stat.isFile())files.push({key,bytes:stat.size,mtime:stat.mtimeMs});}
  files.sort((a,b)=>b.mtime-a.mtime);let bytes=files.reduce((n,f)=>n+f.bytes,0),count=files.length;
  for(const file of files.reverse())if(file.key!==keep&&(count>128||bytes>268435456)){await fs.rm(path.join(this.directory(),file.key+'.png'),{force:true});await fs.rm(path.join(this.directory(),file.key+'.json'),{force:true});bytes-=file.bytes;count--;}
 }
 async shutdown(){this.closing=true;for(const c of this.controllers)c.abort();await this.queue.catch(()=>{});}
}
