import {validateTextPreparation,withPreparationSignal} from './text-preparation.ts';
import type {TextPrepareProvider,TextPreparationState} from './text-preparation.ts';
import type {Document,Asset,Clip,Diagnostic} from '../../../../packages/core/src/document.ts';
import type {Rational} from '../../../../packages/core/src/time.ts';
import {toNumber,frameTime} from '../../../../packages/core/src/time.ts';
import {createPreviewPlan,outputTime,previewFrame,sourceSeekTime,textRasterMode,sourceBoundaryHeld} from './plan.ts';
import type {PreviewPlan,PreviewSupport,PreviewReason,PlannedFrame} from './plan.ts';
import {DecodedMedia} from './decode.ts';
import {TextFrameWindows} from './text-window.ts';
import {TextFrameCache} from './text-cache.ts';
import type {TextFrameRequest,TextCacheMetrics,TextBatchProvider} from './text-cache.ts';
export type {TextContext,TextTexture} from './text-cache.ts';
import type {TextContext,TextTexture} from './text-cache.ts';
import {createCurveClock} from './curve-clock.ts';
import type {CurveClock} from './curve-clock.ts';
import {PreviewAudio} from './audio.ts';
import {CurveSounds} from './curve-sound.ts';
import type {CurveAudioProvider} from './curve-sound.ts';
import {WebGLCompositor} from './webgl.ts';
import type {GLInfo} from './webgl.ts';
import type {PixelPoint,PreviewColorState} from './color.ts';
import {decodedColorSample} from './diagnostics.ts';
import type {DecodedColorSample,PreviewColorDiagnostic} from './diagnostics.ts';
export {createPreviewPlan,outputTime,previewFrame,layerVertices} from './plan.ts';

export type PreviewState='idle'|'loading'|'ready'|'playing'|'paused'|'buffering'|'fallback'|'context-lost'|'disposed';
export type PreviewMetrics={displayedFrames:number;droppedOutputFrames:number;decoderDroppedFrames:number;drawCalls:number;textureUploads:number;
 framebufferPasses:number;transitionDraws:number;framebufferCount:number;framebufferBytes:number;framebufferAllocations:number;
 lastCpuMs:number;meanCpuMs:number;lastGpuMs?:number;lastDecodeWaitMs:number;maxSourceDriftMs:number;lastPresentedFrame:number;activeMedia:number;cachedMedia:number;contextLosses:number;bufferEvents:number;coldTextPrepareMs:number};
export type PreviewManifest={backend:'webgl2';state:PreviewState;support:PreviewSupport;renderer:GLInfo;color:PreviewColorState;time:number;frameRasters:number;previewQuality:'realtime'|'exact-frames';audioState:AudioContextState|'uninitialized';metrics:PreviewMetrics;textCache?:TextCacheMetrics;textPreparation?:TextPreparationState;curveAudio:{cachedClips:number;pcmBytes:number;routes:PreviewAudio['curveRoutes']};
 decoders:{clipId:string;state:string;currentTime?:number;decodedMediaTime?:number;readyState?:number;presentedFrames:number;error?:string}[];error?:PreviewReason};
export type GpuPreviewOptions={prepareText?:TextPrepareProvider;curveAudio?:CurveAudioProvider;textTextures?:TextBatchProvider;textTexture?:(clipId:string,context:TextContext,signal:AbortSignal)=>Promise<TextTexture>;mediaUrl:(asset:Asset)=>string;maxDimension?:number;maxConcurrentMedia?:number;maxCachedMedia?:number;
 onState?:(manifest:PreviewManifest)=>void;onTime?:(seconds:number)=>void;onMetrics?:(manifest:PreviewManifest)=>void};
const unsupported:PreviewSupport={supported:false,reasons:[],visualLayers:0,audioLayers:0,maxConcurrentMedia:0};
const aborted=(e:unknown)=>(e as Error)?.name==='AbortError';

/** Independent visual/audio transport. setDocument and seek never create/resume AudioContext. */
export class GpuPreview {
 readonly canvas:HTMLCanvasElement;private options:GpuPreviewOptions;
 private compositor:WebGLCompositor;private audio=new PreviewAudio();private plan?:PreviewPlan;
 private sounds?:CurveSounds;private textContext?:TextContext;private curveClocks=new Map<string,CurveClock>();
 private preparation?:TextPreparationState;private preparationPromise?:Promise<void>;private preparationStarted=0;
 private textWindows?:TextFrameWindows;private activeTextSlots=new Set<string>();private textCache?:TextFrameCache;private resources=new Map<string,DecodedMedia>();private textResourceFrames=new Map<string,number>();private support:PreviewSupport=unsupported;private error?:PreviewReason;
 private status:PreviewState='idle';private disposed=false;private playing=false;private buffering=false;private operation=new AbortController();private epoch=0;
 private raf?:number;private position=0;private anchorPosition=0;private anchorWall=0;private anchorAudio=0;private metricsAt=0;
 private stats:PreviewMetrics={displayedFrames:0,droppedOutputFrames:0,decoderDroppedFrames:0,drawCalls:0,textureUploads:0,framebufferPasses:0,transitionDraws:0,framebufferCount:0,framebufferBytes:0,framebufferAllocations:0,lastCpuMs:0,meanCpuMs:0,lastDecodeWaitMs:0,maxSourceDriftMs:0,lastPresentedFrame:-1,activeMedia:0,cachedMedia:0,contextLosses:0,bufferEvents:0,coldTextPrepareMs:0};
 private lost=(event:Event)=>{event.preventDefault();if(this.disposed)return;this.stats.contextLosses++;this.stopTransport();this.cancelTextPreparation();this.epoch++;this.operation.abort();this.compositor.abandon();this.setState('context-lost');};
 private restored=()=>{if(this.disposed)return;try{this.compositor.dispose();this.compositor=new WebGLCompositor(this.canvas);this.resize();this.error=undefined;this.setState('paused');void this.seek(this.position).catch(e=>this.fail(e));}catch(e){this.fail(e);}};
 constructor(canvas:HTMLCanvasElement,options:GpuPreviewOptions){
  this.canvas=canvas;this.options=options;this.textCache=options.textTexture?new TextFrameCache(options.textTexture,undefined,undefined,options.textTextures):undefined;this.sounds=options.curveAudio?new CurveSounds(options.curveAudio,id=>this.audio.release(id)):undefined;
  this.compositor=new WebGLCompositor(canvas);this.resize();canvas.addEventListener('webglcontextlost',this.lost);canvas.addEventListener('webglcontextrestored',this.restored);
 }
 get manifest():PreviewManifest{
  let dropped=this.stats.decoderDroppedFrames;for(const r of this.resources.values())dropped+=r.quality()?.droppedVideoFrames||0;
  const unavailable=this.error||(this.status==='context-lost'?{code:'GPU_CONTEXT_LOST',message:'图形上下文正在恢复。'}:undefined);
  const support=unavailable?{...this.support,supported:false,reasons:[...this.support.reasons,unavailable]}:this.support;
  const frameRasters=this.plan?.media.filter(l=>l.asset.kind==='text'&&textRasterMode(l.clip)==='frame').length??0;
  return {backend:'webgl2',frameRasters,previewQuality:frameRasters?'exact-frames':'realtime',state:this.status,support:{...support,reasons:support.reasons.map(r=>({...r}))},renderer:{...this.compositor.info},color:this.compositor.colorState,time:this.currentTime,
   textCache:this.textCache?.metrics,textPreparation:this.preparation?{...this.preparation,...(this.preparation.status==='preparing'?{elapsedMs:performance.now()-this.preparationStarted}:{})}:undefined,audioState:this.audio.state,curveAudio:{cachedClips:this.sounds?.size??0,pcmBytes:this.sounds?.bytes??0,routes:this.audio.curveRoutes},metrics:{...this.stats,decoderDroppedFrames:dropped,lastGpuMs:this.compositor.lastGpuMs,cachedMedia:this.resources.size,framebufferCount:this.compositor.framebufferCount,framebufferBytes:this.compositor.framebufferBytes,framebufferAllocations:this.compositor.framebufferAllocations},
   decoders:[...this.resources].map(([clipId,r])=>({clipId,state:r.state,currentTime:r.media?.currentTime,decodedMediaTime:r.decodedTime,readyState:r.media?.readyState,presentedFrames:r.presentedFrames,...(r.error?{error:r.error}:{})})),...(this.error?{error:{...this.error}}:{})};
 }
 get currentTime(){return this.playing?Math.min(this.plan?.duration??0,this.clockTime()):this.position;}
 private clockTime(){return this.buffering?this.position:this.anchorPosition+(this.audio.state==='running'?this.audio.currentTime-this.anchorAudio:(performance.now()-this.anchorWall)/1000);}
 private anchor(time:number){this.position=time;this.anchorPosition=time;this.anchorWall=performance.now();this.anchorAudio=this.audio.currentTime;}
 private setState(state:PreviewState){if(this.status!==state){this.status=state;this.options.onState?.(this.manifest);}}
 private resize(){const c=this.plan?.document.canvas||{width:1280,height:720},factor=Math.min(1,(this.options.maxDimension??1280)/Math.max(c.width,c.height),this.compositor.info.maxTextureSize/Math.max(c.width,c.height));
  this.compositor.resize(Math.max(2,Math.round(c.width*factor/2)*2),Math.max(2,Math.round(c.height*factor/2)*2));}
 private clearResources(){for(const id of [...this.resources.keys()])this.release(id);this.sounds?.clear();this.activeTextSlots?.clear();}
 private release(id:string){const r=this.resources.get(id);if(!r)return;this.stats.decoderDroppedFrames+=r.quality()?.droppedVideoFrames||0;this.audio.release(id);if(!this.textCache?.owns(r))r.dispose();this.resources.delete(id);this.textResourceFrames.delete(id);this.compositor.release(id);}
 private cancelTextPreparation(){if(this.preparation?.status==='preparing')this.preparation={...this.preparation,status:'cancelled',elapsedMs:performance.now()-this.preparationStarted};this.preparationPromise=undefined;}
 private beginOperation(){this.cancelTextPreparation();this.operation.abort();this.operation=new AbortController();return {epoch:++this.epoch,signal:this.operation.signal};}
 private current(epoch:number){return !this.disposed&&epoch===this.epoch&&!this.operation.signal.aborted;}
 private ensure(){if(this.disposed)throw Error('PREVIEW_DISPOSED');if(this.status==='context-lost')throw Error('GPU_CONTEXT_LOST');}
 async setDocument(document:Document,options:{diagnostics?:Diagnostic[];time?:number;textContext?:TextContext}={}):Promise<PreviewManifest>{
  this.ensure();this.stopTransport();this.beginOperation();this.clearResources();this.plan=undefined;this.error=undefined;
  this.preparationPromise=undefined;this.preparation={status:'idle',requested:0,completed:0,uniqueTextures:0,bytes:0,elapsedMs:0};
  this.textContext=options.textContext?{projectId:options.textContext.projectId,revision:options.textContext.revision}:undefined;this.textCache?.reset(this.textContext,document.canvas.width,document.canvas.height);this.curveClocks.clear();
  const result=createPreviewPlan(document,{diagnostics:options.diagnostics,maxConcurrentMedia:this.options.maxConcurrentMedia,texturesAvailable:!!this.options.textTexture&&!!this.textContext,curveAudioAvailable:!!this.sounds&&!!this.textContext});this.support=result.support;this.plan=result.plan;this.textWindows=this.plan?new TextFrameWindows(this.plan.media,this.plan.document.fps):undefined;
  this.stats.lastPresentedFrame=-1;this.position=Math.min(Math.max(0,options.time??this.position),this.plan?.duration??0);this.resize();
  if(!this.plan){this.compositor.draw([],this.resources,document.canvas);this.setState('fallback');return this.manifest;}
  for(const {clip} of this.plan.media)if(clip.speedCurve)this.curveClocks.set(clip.id,createCurveClock(clip));
  this.setState('loading');return this.seek(this.position);
 }
 private displayFrame(time:number|Rational):PlannedFrame{
  const plan=this.plan!,seconds=typeof time==='number'?time:toNumber(time),last=frameTime(plan.frameCount-1,plan.document.fps);
  const at=seconds>=plan.duration?last:outputTime(time,plan.document.fps);return previewFrame(plan,at);
 }
 async seek(time:number|Rational,options:{prefetch?:boolean}={}):Promise<PreviewManifest>{
  this.ensure();this.stopTransport();if(!this.plan||!this.support.supported)return this.manifest;
  const op=this.beginOperation(),raw=typeof time==='number'?time:toNumber(time);this.position=Math.max(0,Math.min(Number.isFinite(raw)?raw:0,this.plan.duration));
  const frame=this.displayFrame(this.position);this.setState('loading');
  try{await this.prepare(frame,true,false,op.signal);if(!this.current(op.epoch))return this.manifest;
   // Let the browser finish the paused decoded frame before uploading it as a texture.
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(!this.current(op.epoch))return this.manifest;
   this.paint(frame,false);this.setState('ready');if(options.prefetch!==false)void this.warmTextFrames(op.signal).catch(()=>{});return this.manifest;
  }catch(e){if(!aborted(e)&&this.current(op.epoch))this.fail(e);return this.manifest;}
 }
 /** Call from the actual transport-button gesture so audio resume is authorized by browser policy. */
 async play(from?:number):Promise<void>{
  this.ensure();if(!this.plan||!this.support.supported||this.error)return;this.stopTransport(false);
  const op=this.beginOperation(),start=from??(this.position>=this.plan.duration?0:this.position),frame=this.displayFrame(start);
  this.position=toNumber(frame.time);this.setState('buffering');
  try{
   if(this.plan.audio.length)await this.audio.start();if(!this.current(op.epoch))return;
   const textStarted=performance.now();await this.prepareTextFrames(op.signal);this.stats.coldTextPrepareMs=performance.now()-textStarted;if(!this.current(op.epoch))return;
   await this.prepare(frame,true,true,op.signal);if(!this.current(op.epoch))return;
   this.anchor(toNumber(frame.time));this.playing=true;this.syncAudio(frame,this.position);this.paint(frame,false);this.setState('playing');this.raf=requestAnimationFrame(()=>{void this.tick(op.epoch);});
  }catch(e){if(!aborted(e)&&this.current(op.epoch))this.fail(e);}
 }
 pause(){if(this.disposed)return;this.stopTransport();this.beginOperation();if(this.status!=='fallback'&&this.status!=='context-lost')this.setState('paused');}
 /** Explicit developer/user diagnostic only. Pauses, bounds readback to 16 points and restores normal paint. */
 async diagnoseColor(points?:PixelPoint[],compareUnpack=false):Promise<PreviewColorDiagnostic>{
  this.ensure();this.pause();await this.seek(this.position);if(!this.plan||this.status==='fallback')throw Error('GPU_DIAGNOSTIC_PREVIEW_UNAVAILABLE');
  const frame=this.displayFrame(this.position),samplePoints=points??[{x:Math.floor(this.canvas.width/2),y:Math.floor(this.canvas.height/2)}];
  const sources=frame.media.map(l=>{const r=this.resources.get(l.clip.id);return r?decodedColorSample(r):undefined;}).filter((s):s is DecodedColorSample=>!!s);
  try{
   const passes=[this.compositor.diagnose(frame.layers,this.resources,this.plan.document.canvas,samplePoints,'browser-default')];
   if(compareUnpack)passes.push(this.compositor.diagnose(frame.layers,this.resources,this.plan.document.canvas,samplePoints,'none'));
   return {version:1,time:this.position,frame:frame.frame,state:this.compositor.colorState,passes,sources,notice:'readPixels为buffer原始RGBA；Canvas2D采样为源素材中心sRGB，不等于CSS显示或截图profile。NONE仅诊断，结束恢复browser-default；未采用gamma补偿。'};
  }finally{this.compositor.draw(frame.layers,this.resources,this.plan.document.canvas);}
 }
 private stopTransport(suspendAudio=true){
  if(this.playing)this.position=this.currentTime;this.playing=false;this.buffering=false;if(this.raf!==undefined)cancelAnimationFrame(this.raf);this.raf=undefined;
  for(const r of this.resources.values())r.pause();this.audio.silence();if(suspendAudio)void this.audio.suspend().catch(()=>{});
 }
 private holdForBuffer(frame:PlannedFrame){
  if(!this.playing||this.buffering)return;this.position=toNumber(frame.time);this.buffering=true;this.stats.bufferEvents++;
  for(const r of this.resources.values())r.pause();this.audio.silence();this.setState('buffering');
 }
 private async prepare(frame:PlannedFrame,seekAll:boolean,play:boolean,signal:AbortSignal):Promise<boolean>{
  const started=performance.now(),plan=this.plan!,activeIds=new Set(frame.media.map(l=>l.clip.id));let synchronized=seekAll;
  this.activeTextSlots=new Set(frame.media.filter(l=>l.asset.kind==='text').map(l=>l.clip.id));
  const curves=frame.audio.filter(l=>l.clip.speedCurve),curveIds=new Set(curves.map(l=>l.clip.id));
  if(frame.media.some(l=>l.asset.kind==='text'&&!this.textCache?.get(this.textRequest(l,frame.frame))))synchronized=true;
  if(curves.some(l=>!this.sounds?.get(l.clip.id)))synchronized=true;
  if(play&&synchronized)this.holdForBuffer(frame);
  for(const [id,r] of this.resources)if(!activeIds.has(id))r.pause();
  // Curve audio-only clips use PCM directly, never an extra native HTMLAudio route.
  const originalMedia=frame.media.filter(l=>!(l.asset.kind==='audio'&&l.clip.speedCurve)),heldIds=new Set(originalMedia.filter(l=>l.asset.kind==='video'&&sourceBoundaryHeld(l.clip,l.asset,frame.time)).map(l=>l.clip.id));
  const [requested]=await Promise.all([Promise.all(originalMedia.map(async layer=>{
   let r=this.resources.get(layer.clip.id);let url=layer.asset.kind==='text'?r?.url:this.options.mediaUrl(layer.asset),asset=layer.asset;
   if(layer.asset.kind==='text'){
    if(!this.textCache)throw Error('GPU_TEXT_TEXTURE_SERVICE_REQUIRED');
    const cached=await this.textCache.prepare(this.textRequest(layer,frame.frame),signal,()=>this.textPins());
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(r!==cached){if(r&&!this.textCache.owns(r))this.release(layer.clip.id);this.resources.set(layer.clip.id,cached);r=cached;}
    this.textResourceFrames.set(layer.clip.id,frame.frame);asset=cached.asset;url=cached.url;
   }
   if(!url)throw Error('GPU_REGISTERED_MEDIA_URL_REQUIRED');
   if(r&&layer.asset.kind!=='text'&&(r.asset.id!==layer.asset.id||r.url!==url)){this.release(r.id);r=undefined;}
   if(signal.aborted)throw new DOMException('Aborted','AbortError');
   if(!r){r=new DecodedMedia(layer.clip.id,asset,url,10000,{textRaster:asset.kind==='text'});this.resources.set(r.id,r);if(asset.kind==='text'&&textRasterMode(layer.clip)==='frame')this.textResourceFrames.set(r.id,frame.frame);synchronized=true;}
   r.lastUsed=performance.now();if(r.state==='loading')synchronized=true;return {layer,resource:r};
  })),Promise.all(curves.map(layer=>{
    if(!this.sounds||!this.textContext)throw Error('GPU_CURVE_AUDIO_SERVICE_REQUIRED');
    return this.sounds.prepare(layer,this.textContext,signal,curveIds);
  }))]);
  if(play&&synchronized)this.holdForBuffer(frame);
  await Promise.all(requested.map(async({layer,resource})=>{
   await resource.ready;if(signal.aborted)throw new DOMException('Aborted','AbortError');if(resource.state==='error')throw Error(resource.error);
   const media=resource.media;if(!media)return;
   const target=sourceSeekTime(layer.clip,layer.asset,frame.time,plan.document.fps),speed=this.curveClocks.get(layer.clip.id)?.sample(frame.time).playbackRate??toNumber(layer.clip.speed);
   const drift=this.curveClocks.get(layer.clip.id)?.targetDrift(media.currentTime,frame.time)??Math.abs(media.currentTime-target)/speed;
   if(this.playing&&!this.buffering&&!media.paused)this.stats.maxSourceDriftMs=Math.max(this.stats.maxSourceDriftMs,drift*1000);
   if(layer.clip.speedCurve||heldIds.has(layer.clip.id)){
    // Native curve video remains silent and paused. The target-clock PCM is
    // independently scheduled after the transport anchor, never rate-warped here.
    resource.pause();media.muted=true;await resource.seek(target,signal);
    if(layer.clip.speedCurve&&play&&!seekAll)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   }else if(seekAll||media.paused||media.readyState<2||drift>Math.max(.08,2/toNumber(plan.document.fps))){synchronized=true;if(play)this.holdForBuffer(frame);await resource.seek(target,signal);}
   media.playbackRate=speed;media.preservesPitch=true;
  }));
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(play)await Promise.all(requested.map(({layer,resource})=>!layer.clip.speedCurve&&!heldIds.has(layer.clip.id)&&resource.media?.paused?resource.media.play():undefined));
  this.stats.lastDecodeWaitMs=performance.now()-started;this.stats.activeMedia=activeIds.size;
  const inactive=[...this.resources].filter(([id])=>!activeIds.has(id)).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);
  while(this.resources.size>(this.options.maxCachedMedia??24)&&inactive.length)this.release(inactive.shift()![0]);
  return synchronized;
 }
 private textRequest(layer:{clip:Clip;asset:Asset},frame:number):TextFrameRequest{
  const mode=textRasterMode(layer.clip);
  return {clipId:layer.clip.id,asset:layer.asset,...(mode?{mode}:{}),...(mode==='frame'?{frame}:{})};
 }
 /** Bounded silent preparation. Never starts/resumes WebAudio or changes transport. */
 async prepareTextFrames(signal?:AbortSignal):Promise<void>{
  const prepareStarted=performance.now(),generation=this.epoch,operationSignal=signal?AbortSignal.any([signal,this.operation.signal]):this.operation.signal;
  await this.warmTextFrames(operationSignal);if(operationSignal.aborted||generation!==this.epoch||this.disposed)throw new DOMException('Aborted','AbortError');
  if(!this.options.prepareText||!this.textContext||!this.plan||!this.textWindows||this.disposed)return;
  if(this.preparationPromise)return withPreparationSignal(this.preparationPromise,operationSignal);
  const context={...this.textContext},start=this.displayFrame(this.position).frame,frames=this.textWindows.at(start,300).filter(r=>r.mode==='frame').map(r=>({clipId:r.clipId,frame:r.frame!}));if(!frames.length)return;
  const epoch=generation;if(operationSignal.aborted)throw new DOMException('Aborted','AbortError');this.preparationStarted=prepareStarted;this.preparation={status:'preparing',requested:frames.length,completed:0,uniqueTextures:0,bytes:0,elapsedMs:0};this.options.onMetrics?.(this.manifest);
  const task=Promise.resolve().then(async()=>{try{const result=await this.options.prepareText!(context,frames,operationSignal);
   if(operationSignal.aborted||epoch!==this.epoch||this.disposed)throw new DOMException('Aborted','AbortError');validateTextPreparation(result,context,frames.length);this.preparation={status:result.status,requested:result.requested,completed:result.completed,uniqueTextures:result.uniqueTextures,bytes:result.bytes,elapsedMs:performance.now()-this.preparationStarted,...(result.reason?{reason:result.reason}:{})};
  }catch(error){if(this.preparationPromise===task&&epoch===this.epoch&&!this.disposed)this.preparation={...this.preparation!,status:aborted(error)?'cancelled':'error',elapsedMs:performance.now()-this.preparationStarted};throw error;}finally{if(this.preparationPromise===task){this.preparationPromise=undefined;if(epoch===this.epoch&&!this.disposed)this.options.onMetrics?.(this.manifest);}}});
  this.preparationPromise=task;void task.catch(()=>{});return withPreparationSignal(task,operationSignal).catch(error=>{if(aborted(error)&&this.preparationPromise===task&&epoch===this.epoch&&!this.disposed){this.preparation={...this.preparation!,status:'cancelled',elapsedMs:performance.now()-this.preparationStarted};this.preparationPromise=undefined;}throw error;});
 }
 /** Automatic setDocument/seek work is limited to the decoded first window. */
 private async warmTextFrames(signal?:AbortSignal):Promise<void>{
  if(!this.textCache||!this.plan||!this.textContext||this.disposed||!this.plan.media.some(l=>l.asset.kind==='text'))return;
  const plan=this.plan,start=this.displayFrame(this.position).frame,self=this,epoch=this.epoch;
  function* requests(){const counts=new Map<string,number>();for(let f=start;f<Math.min(plan.frameCount,start+300);f++){
   const frame=previewFrame(plan,frameTime(f,plan.document.fps));for(const layer of frame.media)if(layer.asset.kind==='text'){
    const mode=textRasterMode(layer.clip),n=counts.get(layer.clip.id)??0;if(n>=(mode==='frame'?300:1))continue;counts.set(layer.clip.id,n+1);yield self.textRequest(layer,f);
   }
  }}
  await this.textCache.warm(requests(),signal);if(epoch!==this.epoch||this.disposed||signal?.aborted)return;await this.rollTextFrames(start,signal);
 }
 private textPins():ReadonlySet<string>{
  return new Set([...this.resources].filter(([id,r])=>this.activeTextSlots?.has(id)&&r.asset.kind==='text').map(([,r])=>r.url));
 }
 /** One frame-ordered horizon, no larger than the decoded-image budget. */
 private async rollTextFrames(start:number,signal?:AbortSignal):Promise<void>{
  if(!this.textCache||!this.plan||!this.textContext||this.disposed||!this.plan.media.some(l=>l.asset.kind==='text'))return;
  const capacity=this.textCache.capacity;if(!capacity)return;
  const requests=this.textWindows?.at(start,capacity)??[];if(!requests.length)return;
  const ready=requests.filter(request=>!!this.textCache!.get(request)).length;
  // Refill a half-empty horizon in batches instead of starting a cold FFmpeg
  // process for each new frontier frame. An active producer still receives
  // the latest seek/play window so stale work does not displace useful frames.
  if(!this.textCache.metrics.rolling&&(ready===requests.length||ready>Math.ceil(requests.length/2)))return;
  await this.textCache.roll(requests,()=>this.textPins(),signal);
 }
 private syncAudio(frame:PlannedFrame,time:number){
  const elements=frame.audio.filter(l=>!l.clip.speedCurve).map(({clip})=>({id:clip.id,clip,element:this.resources.get(clip.id)!.media!}));
  this.activeTextSlots=new Set(frame.media.filter(l=>l.asset.kind==='text').map(l=>l.clip.id));
  const curves=frame.audio.filter(l=>l.clip.speedCurve).map(({clip})=>{const pcm=this.sounds?.get(clip.id);if(!pcm)throw Error('GPU_CURVE_AUDIO_NOT_READY');return {id:clip.id,clip,pcm};});
  this.audio.sync(elements,time,curves);
 }
 private paint(frame:PlannedFrame,playing:boolean){
  const began=performance.now(),result=this.compositor.draw(frame.layers,this.resources,this.plan!.document.canvas),elapsed=performance.now()-began;
  if(playing&&this.stats.lastPresentedFrame>=0&&frame.frame>this.stats.lastPresentedFrame+1)this.stats.droppedOutputFrames+=frame.frame-this.stats.lastPresentedFrame-1;
  this.stats.displayedFrames++;this.stats.drawCalls+=result.drawCalls;this.stats.textureUploads+=result.textureUploads;this.stats.lastCpuMs=elapsed;
  this.stats.framebufferPasses+=result.framebufferPasses;this.stats.transitionDraws+=result.transitionDraws;
  this.stats.meanCpuMs+=(elapsed-this.stats.meanCpuMs)/this.stats.displayedFrames;this.stats.lastPresentedFrame=frame.frame;
  if(performance.now()-this.metricsAt>250){this.metricsAt=performance.now();this.options.onMetrics?.(this.manifest);}
 }
 private async tick(epoch:number){
  if(!this.playing||!this.current(epoch)||!this.plan)return;
  const now=this.currentTime;
  if(now>=this.plan.duration){this.stopTransport();this.position=this.plan.duration;await this.seek(this.position);this.options.onTime?.(this.position);return;}
  const frame=previewFrame(this.plan,outputTime(now,this.plan.document.fps,'floor'));
  try{
   // Decoder/seek synchronization belongs to output frames. Repeating it at
   // display refresh rate can restart an ended source and rewind the target clock.
   if(frame.frame!==this.stats.lastPresentedFrame){
    const synced=await this.prepare(frame,false,true,this.operation.signal);if(!this.playing||!this.current(epoch))return;
    if(synced){this.anchor(toNumber(frame.time));this.buffering=false;this.setState('playing');}this.syncAudio(frame,this.currentTime);
    this.paint(frame,true);void this.rollTextFrames(frame.frame,this.operation.signal).catch(()=>{});
   }else this.syncAudio(frame,this.currentTime);
   this.options.onTime?.(this.currentTime);this.raf=requestAnimationFrame(()=>{void this.tick(epoch);});
  }catch(e){if(!aborted(e)&&this.current(epoch))this.fail(e);}
 }
 private fail(e:unknown){
  this.stopTransport();this.operation.abort();this.error={code:(e as Error)?.message?.split(':')[0]||'GPU_PREVIEW_FAILED',message:(e as Error)?.message||String(e)};this.setState('fallback');
 }
 dispose(options:{releaseContext?:boolean}={}){
  if(this.disposed)return;this.stopTransport();this.cancelTextPreparation();this.operation.abort();this.epoch++;this.canvas.removeEventListener('webglcontextlost',this.lost);this.canvas.removeEventListener('webglcontextrestored',this.restored);
  this.clearResources();this.textCache?.dispose();this.audio.dispose();this.compositor.dispose(options.releaseContext);this.disposed=true;this.setState('disposed');
 }
}
