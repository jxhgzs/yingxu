import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {Store,contentHash,atomicJSON} from './store.ts';
import {renderGraph} from '../../packages/media/src/graph.ts';
import {rasterText} from '../../packages/media/src/text-raster.ts';
import {check} from '../../packages/core/src/document.ts';

export function systemFontEnvironmentIdentity(){return {platform:os.platform(),release:os.release(),version:os.version(),arch:os.arch()};}
export type TextTexture={url:string;key:string;clipId:string;revision:number;width:number;height:number};
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
 async request(projectId:string,body:{revision:number;clipId:string},signal?:AbortSignal):Promise<TextTexture>{
  check(!this.closing,'SERVICE_CLOSING');check(this.pending<32,'TEXT_TEXTURE_QUEUE_LIMIT');check(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>k==='revision'||k==='clipId')&&Number.isSafeInteger(body.revision)&&body.revision>=0&&typeof body.clipId==='string'&&body.clipId.length>0&&body.clipId.length<=200,'INVALID_TEXT_TEXTURE_REQUEST');
  const project=this.store.get(projectId);check(project.revision===body.revision,'REVISION_CONFLICT');check(project.diagnostics.length===0,'UNSUPPORTED_DRAFT_EFFECTS');
  const graph=renderGraph(project.document),layer=graph.layers.find(l=>l.clip.id===body.clipId);check(layer?.asset.kind==='text','TEXT_RASTER_CLIP_REQUIRED');
  check(!layer.clip.animations?.some(a=>a.property!=='volume')&&!layer.clip.speedCurve,'TEXT_RASTER_ANIMATION_UNSUPPORTED');
  const key=contentHash({version:'libass-static-rgba-v1',engine:this.options.engine,fontEnvironment:this.fontEnvironment,canvas:graph.document.canvas,text:layer.clip.text,transform:layer.clip.transform});
  const result:TextTexture={key,url:`/text-renders/${key}.png`,clipId:body.clipId,revision:body.revision,...graph.document.canvas};
  const controller=new AbortController(),cancel=()=>controller.abort();if(signal?.aborted)controller.abort();signal?.addEventListener('abort',cancel,{once:true});this.controllers.add(controller);this.pending++;
  const task=this.queue.catch(()=>{}).then(async()=>{
   check(!this.closing,'SERVICE_CLOSING');if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
   // A queued request must still belong to the captured revision, not silently raster a newer document.
   check(this.store.get(projectId).revision===body.revision,'REVISION_CONFLICT');
   try{await this.file(key);return result;}catch(error:any){if(error.code!=='ENOENT')throw error;}
   await fs.mkdir(this.directory(),{recursive:true});const temporary=path.join(this.directory(),'.'+randomUUID());
   try{const rendered=await rasterText(layer,graph.document.canvas,temporary,{signal:controller.signal});if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
    const bytes=await fs.readFile(rendered.path);check(bytes.length<=134217728,'TEXT_RASTER_SIZE_LIMIT');const target=path.join(this.directory(),key+'.png');
    await fs.rename(rendered.path,target);await atomicJSON(path.join(this.directory(),key+'.json'),{key,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width:result.width,height:result.height,engine:this.options.engine,fontEnvironment:this.fontEnvironment});
    await this.prune(key);return result;
   }finally{await fs.rm(temporary,{recursive:true,force:true});}
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
