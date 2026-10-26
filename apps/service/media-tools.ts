import fs from 'node:fs/promises';
import {Store} from './store.ts';import {check} from '../../packages/core/src/document.ts';
import {verifyFrameClock} from '../../packages/media/src/clip-media.ts';import {fileHash} from '../../packages/media/src/probe.ts';
import type {MediaToolProof} from '../../packages/core/src/tool-availability.ts';
/** Read-only checks, serialized probes, at most 32 cached source signatures. */
export class MediaTools {
 private store:Store;constructor(store:Store){this.store=store;}
 private abort=new AbortController();private queue:Promise<unknown>=Promise.resolve();
 private cache=new Map<string,{promise:Promise<MediaToolProof>;settled:boolean}>();
 async inspect(projectId:string,assetId:string):Promise<MediaToolProof>{
  check(!this.abort.signal.aborted,'SERVICE_CLOSING');const asset=this.store.get(projectId).document.assets.find(a=>a.id===assetId);check(asset,'ASSET_NOT_FOUND');
  const registered=this.store.assets.get(assetId);
  if(!registered||registered.path!==asset.path||registered.sha256!==asset.sha256)return {reason:'MEDIA_NOT_LINKED',fileReason:'MEDIA_NOT_LINKED'};
  let stat;try{stat=await fs.stat(asset.path);}catch{return {reason:'MEDIA_SOURCE_MISSING',fileReason:'MEDIA_SOURCE_MISSING'};}
  const key=JSON.stringify([asset.id,asset.path,asset.sha256,stat.size,stat.mtimeMs,stat.ctimeMs,asset.kind,asset.fps]);const cached=this.cache.get(key);if(cached)return cached.promise;
  if(this.cache.size>=32){const settled=[...this.cache].find(([,v])=>v.settled);if(settled)this.cache.delete(settled[0]);else return {reason:'MEDIA_TOOL_BUSY',fileReason:'MEDIA_TOOL_BUSY'};}
  const entry={promise:Promise.resolve<MediaToolProof>({reason:'MEDIA_TOOL_CHECKING'}),settled:false};
  entry.promise=this.queue.catch(()=>{}).then(async()=>{
   if(this.abort.signal.aborted)return {reason:'SERVICE_CLOSING',fileReason:'SERVICE_CLOSING'};
   try{if(await fileHash(asset.path)!==asset.sha256)return {reason:'MEDIA_HASH_CHANGED',fileReason:'MEDIA_HASH_CHANGED'};
    if((asset.kind||'video')!=='video')return {reason:'',fileReason:''};
    const frames=await verifyFrameClock(asset,this.abort.signal);return {reason:'',fileReason:'',frames};
   }catch(e){const reason=e instanceof Error?e.message:String(e);return {reason:reason.startsWith('MEDIA_OPERATION_FRAME_TIMING')?'MEDIA_OPERATION_FRAME_TIMING':'MEDIA_SOURCE_UNREADABLE',fileReason:reason.startsWith('MEDIA_OPERATION_FRAME_TIMING')?'':'MEDIA_SOURCE_UNREADABLE'};}
  }).finally(()=>{entry.settled=true;});this.queue=entry.promise;this.cache.set(key,entry);return entry.promise;
 }
 async shutdown(){this.abort.abort();await this.queue.catch(()=>{});this.cache.clear();}
}
