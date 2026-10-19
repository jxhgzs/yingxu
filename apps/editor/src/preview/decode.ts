import type {Asset} from '../../../../packages/core/src/document.ts';

export type DecodeState='loading'|'ready'|'error'|'disposed';
export class DecodedMedia {
 readonly id:string;readonly asset:Asset;readonly url:string;readonly element:HTMLVideoElement|HTMLAudioElement|HTMLImageElement;
 readonly ready:Promise<void>;state:DecodeState='loading';error?:string;lastUsed=0;decodedTime?:number;presentedFrames=0;
 private abort=new AbortController();private frameCallback?:number;
 constructor(id:string,asset:Asset,url:string,timeoutMs=10000){
  this.id=id;this.asset=asset;this.url=url;
  const parsed=new URL(url,globalThis.location?.href);
  if(!['http:','https:'].includes(parsed.protocol)||!['localhost','127.0.0.1'].includes(parsed.hostname)||parsed.pathname!==`/media/${asset.id}`)
   throw Error('GPU_REGISTERED_MEDIA_URL_REQUIRED');
  if(asset.kind==='image'){
   const image=new Image();image.crossOrigin='anonymous';image.decoding='async';this.element=image;
   this.ready=this.wait('load',timeoutMs).then(async()=>{if(!image.naturalWidth||!image.naturalHeight)throw Error('GPU_IMAGE_DECODE_FAILED');if(image.decode)await image.decode();this.state='ready';});
   image.src=url;
  }else{
   const element=document.createElement(asset.kind==='audio'?'audio':'video');element.crossOrigin='anonymous';element.preload='auto';element.muted=true;element.volume=1;element.preservesPitch=true;
   if(element instanceof HTMLVideoElement)element.playsInline=true;this.element=element;
   this.ready=this.wait('loadeddata',timeoutMs).then(()=>{if(!Number.isFinite(element.duration)||element.duration<=0)throw Error('GPU_MEDIA_DURATION_INVALID');this.state='ready';this.observeFrames();});
   element.src=url;element.load();
  }
  this.ready=this.ready.catch(e=>{if(this.state!=='disposed'){this.state='error';this.error=(e as Error).message;}throw e;});
  this.element.addEventListener('error',()=>{if(this.state!=='disposed'){this.state='error';this.error='GPU_MEDIA_DECODE_FAILED';}},{signal:this.abort.signal});
 }
 private wait(event:string,timeout:number,external?:AbortSignal,action?:()=>void):Promise<void>{
  return new Promise((resolve,reject)=>{
   const el=this.element,finish=(error?:unknown)=>{clearTimeout(timer);el.removeEventListener(event,success);el.removeEventListener('error',failure);this.abort.signal.removeEventListener('abort',cancel);external?.removeEventListener('abort',cancel);error?reject(error):resolve();};
   const success=()=>finish(),failure=()=>finish(Error('GPU_MEDIA_DECODE_FAILED')),cancel=()=>finish(new DOMException('Aborted','AbortError'));
   const timer=setTimeout(()=>finish(Error(event==='seeked'?'GPU_SEEK_TIMEOUT':'GPU_MEDIA_LOAD_TIMEOUT')),timeout);
   el.addEventListener(event,success,{once:true});el.addEventListener('error',failure,{once:true});this.abort.signal.addEventListener('abort',cancel,{once:true});external?.addEventListener('abort',cancel,{once:true});
   if(this.abort.signal.aborted||external?.aborted){cancel();return;}
   try{action?.();}catch(e){finish(e);}
  });
 }
 get media():HTMLMediaElement|undefined{return this.asset.kind==='image'?undefined:this.element as HTMLMediaElement;}
 get pixels():HTMLVideoElement|HTMLImageElement|undefined{return this.asset.kind==='audio'?undefined:this.element as HTMLVideoElement|HTMLImageElement;}
 async seek(seconds:number,signal?:AbortSignal){
  await this.ready;if(signal?.aborted)throw new DOMException('Aborted','AbortError');const media=this.media;if(!media)return;
  const at=Math.max(0,Math.min(seconds,media.duration-.000001));
  if(Math.abs(media.currentTime-at)<.000001&&!media.seeking&&media.readyState>=2)return;
  await this.wait('seeked',8000,signal,()=>{media.currentTime=at;});
  if(media.readyState<2)await this.wait('loadeddata',8000,signal);
 }
 private observeFrames(){
  if(!(this.element instanceof HTMLVideoElement)||!this.element.requestVideoFrameCallback)return;
  const video=this.element,callback=(_now:number,metadata:VideoFrameCallbackMetadata)=>{
   if(this.state==='disposed')return;this.decodedTime=metadata.mediaTime;this.presentedFrames=metadata.presentedFrames;
   this.frameCallback=video.requestVideoFrameCallback(callback);
  };this.frameCallback=video.requestVideoFrameCallback(callback);
 }
 pause(){this.media?.pause();}
 quality(){const video=this.element instanceof HTMLVideoElement?this.element:undefined;return video?.getVideoPlaybackQuality?.();}
 dispose(){
  if(this.state==='disposed')return;this.state='disposed';this.abort.abort();
  if(this.element instanceof HTMLVideoElement&&this.frameCallback!==undefined)this.element.cancelVideoFrameCallback?.(this.frameCallback);
  this.pause();this.element.removeAttribute('src');if(this.media)this.media.load();this.element.remove();
 }
}
