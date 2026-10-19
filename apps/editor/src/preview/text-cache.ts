import type {Asset} from '../../../../packages/core/src/document.ts';
import {DecodedMedia} from './decode.ts';
export type TextContext={projectId:string;revision:number;mode?:'neutral'|'frame';frame?:number};
export type TextTexture={url:string;width:number;height:number;mode?:'neutral'|'frame';frame?:number;clipId?:string;revision?:number};
export type TextFrameRequest={clipId:string;asset:Asset;mode?:'neutral'|'frame';frame?:number};
type Provider=(clipId:string,context:TextContext,signal:AbortSignal)=>Promise<TextTexture>;
type Resource=Pick<DecodedMedia,'ready'|'state'|'url'|'dispose'>;
export type TextCacheMetrics={textures:number;bytes:number;aliases:number;requests:number;hits:number;decodes:number;warming:boolean;budgetStops:number;warmMs:number};
const abort=()=>new DOMException('Aborted','AbortError');
function withSignal<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!signal)return promise;if(signal.aborted){void promise.catch(()=>{});return Promise.reject(abort());}
 return new Promise((resolve,reject)=>{const cancel=()=>{cleanup();reject(abort());},cleanup=()=>signal.removeEventListener('abort',cancel);signal.addEventListener('abort',cancel,{once:true});promise.then(v=>{cleanup();resolve(v);},e=>{cleanup();reject(e);});});
}
/** Revision-isolated decoded PNG cache. Warming never evicts earlier frames. */
export class TextFrameCache<R extends Resource=DecodedMedia>{
 private budgetBlocked?:string;private context?:TextContext;private width=0;private height=0;private epoch=0;private controller=new AbortController();private disposed=false;
 private aliases=new Map<string,{url:string;clipId:string}>();private entries=new Map<string,{resource:R;bytes:number;used:number}>();private pending=new Map<string,Promise<R|undefined>>();private warmPromise?:Promise<void>;
 private counters={requests:0,hits:0,decodes:0,budgetStops:0,warmMs:0};
 private provider:Provider;private create:(request:TextFrameRequest,texture:TextTexture)=>R;private limits:{textures:number;bytes:number;aliasesPerClip:number};
 constructor(provider:Provider,create:(request:TextFrameRequest,texture:TextTexture)=>R=((request,texture)=>new DecodedMedia(request.clipId,{...request.asset,width:texture.width,height:texture.height},texture.url,10000,{textRaster:true}) as unknown as R),limits={textures:32,bytes:128*1024*1024,aliasesPerClip:300}){this.provider=provider;this.create=create;this.limits=limits;}
 get metrics():TextCacheMetrics{return {textures:this.entries.size,bytes:[...this.entries.values()].reduce((n,e)=>n+e.bytes,0),aliases:this.aliases.size,...this.counters,warming:!!this.warmPromise};}
 reset(context:TextContext|undefined,width:number,height:number){
  this.controller.abort();this.controller=new AbortController();this.epoch++;for(const {resource}of this.entries.values())resource.dispose();this.entries.clear();this.aliases.clear();this.budgetBlocked=undefined;this.pending.clear();this.warmPromise=undefined;
  this.context=context?{projectId:context.projectId,revision:context.revision}:undefined;this.width=width;this.height=height;
 }
 private key(r:TextFrameRequest){return JSON.stringify([r.clipId,r.mode??'static',r.mode==='frame'?r.frame:null]);}
 get(request:TextFrameRequest):R|undefined{const alias=this.aliases.get(this.key(request)),entry=alias&&this.entries.get(alias.url);if(entry?.resource.state==='ready'){entry.used=performance.now();this.counters.hits++;return entry.resource;}return undefined;}
 owns(resource:Resource){return this.entries.get(resource.url)?.resource===resource;}
 prepare(request:TextFrameRequest,signal?:AbortSignal,pinned:ReadonlySet<string>=new Set()):Promise<R>{
  if(this.disposed)return Promise.reject(Error('GPU_TEXT_CACHE_DISPOSED'));if(signal?.aborted)return Promise.reject(abort());const ready=this.get(request);if(ready)return withSignal(Promise.resolve(ready),signal);
  const epoch=this.epoch,pending=this.load(request,false,pinned);
  return withSignal(pending.then(async resource=>{
   if(resource)return resource;
   // A foreground request may have joined a non-evicting warm request. Once
   // warming hits capacity, retry once with foreground eviction privileges.
   if(signal?.aborted||epoch!==this.epoch||this.disposed)throw abort();
   const key=this.key(request);if(this.pending.get(key)===pending)this.pending.delete(key);
   const retry=await this.load(request,false,pinned);if(!retry)throw Error('GPU_TEXT_CACHE_BUDGET');return retry;
  }),signal);
 }
 private load(request:TextFrameRequest,warm:boolean,pinned:ReadonlySet<string>):Promise<R|undefined>{
  const key=this.key(request),pending=this.pending.get(key);if(pending)return pending;
  const epoch=this.epoch,signal=this.controller.signal,context=this.context;
  if(this.disposed||!context)return Promise.reject(Error('GPU_TEXT_TEXTURE_SERVICE_REQUIRED'));
  if(request.mode==='frame'&&(!Number.isSafeInteger(request.frame)||request.frame!<0))return Promise.reject(Error('GPU_TEXT_TEXTURE_MODE_INVALID'));
  const job=(async()=>{
   const hit=this.get(request);if(hit)return hit;if(warm&&this.budgetBlocked===key)return;
   if([...this.aliases.values()].filter(a=>a.clipId===request.clipId).length>=this.limits.aliasesPerClip){if(warm){this.counters.budgetStops++;return;}throw Error('GPU_TEXT_CACHE_ALIAS_LIMIT');}
   this.counters.requests++;
   const texture=await this.provider(request.clipId,{...context,...(request.mode?{mode:request.mode}:{}),...(request.mode==='frame'?{frame:request.frame}:{})},signal);
   if(signal.aborted||epoch!==this.epoch||this.disposed)throw abort();
   if(texture.clipId!==request.clipId||texture.revision!==context.revision)throw Error('GPU_TEXT_TEXTURE_IDENTITY_INVALID');
   if(texture.mode!==request.mode||texture.frame!==(request.mode==='frame'?request.frame:undefined))throw Error('GPU_TEXT_TEXTURE_MODE_INVALID');
   if(texture.width!==this.width||texture.height!==this.height)throw Error('GPU_TEXT_TEXTURE_DIMENSIONS_INVALID');
   const parsed=new URL(texture.url,globalThis.location?.href);if(!['http:','https:'].includes(parsed.protocol)||!['127.0.0.1','localhost'].includes(parsed.hostname)||!/^\/text-renders\/[a-f0-9]{64}\.png$/.test(parsed.pathname))throw Error('GPU_REGISTERED_MEDIA_URL_REQUIRED');
   let entry=this.entries.get(texture.url);const bytes=this.width*this.height*4;
   if(!entry){
    while(this.entries.size>=this.limits.textures||this.metrics.bytes+bytes>this.limits.bytes){
     if(warm){this.counters.budgetStops++;this.budgetBlocked=key;return;}
     const candidate=[...this.entries].filter(([url])=>!pinned.has(url)).sort((a,b)=>a[1].used-b[1].used)[0];
     if(!candidate)throw Error('GPU_TEXT_CACHE_BUDGET');this.remove(candidate[0]);
    }
    if(signal.aborted||epoch!==this.epoch||this.disposed)throw abort();
    const resource=this.create(request,texture);entry={resource,bytes,used:performance.now()};this.entries.set(texture.url,entry);this.counters.decodes++;
    try{await resource.ready;if(signal.aborted||epoch!==this.epoch||this.disposed)throw abort();if(resource.state!=='ready')throw Error('GPU_IMAGE_DECODE_FAILED');}catch(error){if(this.entries.get(texture.url)?.resource===resource)this.remove(texture.url);else resource.dispose();throw error;}
   }else{await entry.resource.ready;if(signal.aborted||epoch!==this.epoch||this.disposed)throw abort();}
   if(!this.aliases.has(key)&&[...this.aliases.values()].filter(a=>a.clipId===request.clipId).length>=this.limits.aliasesPerClip){if(warm){this.counters.budgetStops++;return;}throw Error('GPU_TEXT_CACHE_ALIAS_LIMIT');}
   entry.used=performance.now();this.aliases.set(key,{url:texture.url,clipId:request.clipId});return entry.resource;
  })();
  this.pending.set(key,job);void job.finally(()=>{if(this.pending.get(key)===job)this.pending.delete(key);}).catch(()=>{});return job;
 }
 private remove(url:string){this.budgetBlocked=undefined;this.entries.get(url)?.resource.dispose();this.entries.delete(url);for(const[key,alias]of this.aliases)if(alias.url===url)this.aliases.delete(key);}
 warm(requests:Iterable<TextFrameRequest>,signal?:AbortSignal):Promise<void>{
  if(this.disposed)return Promise.reject(Error('GPU_TEXT_CACHE_DISPOSED'));if(this.warmPromise)return withSignal(this.warmPromise,signal);
  const epoch=this.epoch,start=performance.now();const run=(async()=>{for(const request of requests){if(signal?.aborted||this.controller.signal.aborted||epoch!==this.epoch||this.disposed)throw abort();if(!this.get(request)&&!await this.load(request,true,new Set()))break;}})();
  const tracked=run.finally(()=>{if(this.warmPromise===tracked){this.counters.warmMs+=performance.now()-start;this.warmPromise=undefined;}});this.warmPromise=tracked;void tracked.catch(()=>{});return withSignal(tracked,signal);
 }
 dispose(){if(this.disposed)return;this.reset(undefined,0,0);this.disposed=true;}
}
