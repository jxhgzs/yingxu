import type {Document,Asset,Diagnostic} from '../../../../packages/core/src/document.ts';
import type {Rational} from '../../../../packages/core/src/time.ts';
import {toNumber,frameTime} from '../../../../packages/core/src/time.ts';
import {createPreviewPlan,outputTime,previewFrame,sourceSeekTime} from './plan.ts';
import type {PreviewPlan,PreviewSupport,PreviewReason,PlannedFrame} from './plan.ts';
import {DecodedMedia} from './decode.ts';
import {createCurveClock} from './curve-clock.ts';
import type {CurveClock} from './curve-clock.ts';
import {PreviewAudio} from './audio.ts';
import {WebGLCompositor} from './webgl.ts';
import type {GLInfo} from './webgl.ts';
import type {PixelPoint,PreviewColorState} from './color.ts';
import {decodedColorSample} from './diagnostics.ts';
import type {DecodedColorSample,PreviewColorDiagnostic} from './diagnostics.ts';
export {createPreviewPlan,outputTime,previewFrame,layerVertices} from './plan.ts';

export type PreviewState='idle'|'loading'|'ready'|'playing'|'paused'|'buffering'|'fallback'|'context-lost'|'disposed';
export type PreviewMetrics={displayedFrames:number;droppedOutputFrames:number;decoderDroppedFrames:number;drawCalls:number;textureUploads:number;
 framebufferPasses:number;transitionDraws:number;framebufferCount:number;framebufferBytes:number;framebufferAllocations:number;
 lastCpuMs:number;meanCpuMs:number;lastGpuMs?:number;lastDecodeWaitMs:number;maxSourceDriftMs:number;lastPresentedFrame:number;activeMedia:number;cachedMedia:number;contextLosses:number};
export type PreviewManifest={backend:'webgl2';state:PreviewState;support:PreviewSupport;renderer:GLInfo;color:PreviewColorState;time:number;audioState:AudioContextState|'uninitialized';metrics:PreviewMetrics;
 decoders:{clipId:string;state:string;currentTime?:number;decodedMediaTime?:number;readyState?:number;presentedFrames:number;error?:string}[];error?:PreviewReason};
export type TextContext={projectId:string;revision:number};
export type TextTexture={url:string;width:number;height:number};
export type GpuPreviewOptions={textTexture?:(clipId:string,context:TextContext,signal:AbortSignal)=>Promise<TextTexture>;mediaUrl:(asset:Asset)=>string;maxDimension?:number;maxConcurrentMedia?:number;maxCachedMedia?:number;
 onState?:(manifest:PreviewManifest)=>void;onTime?:(seconds:number)=>void;onMetrics?:(manifest:PreviewManifest)=>void};
const unsupported:PreviewSupport={supported:false,reasons:[],visualLayers:0,audioLayers:0,maxConcurrentMedia:0};
const aborted=(e:unknown)=>(e as Error)?.name==='AbortError';

/** Independent visual/audio transport. setDocument and seek never create/resume AudioContext. */
export class GpuPreview {
 readonly canvas:HTMLCanvasElement;private options:GpuPreviewOptions;
 private compositor:WebGLCompositor;private audio=new PreviewAudio();private plan?:PreviewPlan;
 private textContext?:TextContext;private curveClocks=new Map<string,CurveClock>();
 private resources=new Map<string,DecodedMedia>();private support:PreviewSupport=unsupported;private error?:PreviewReason;
 private status:PreviewState='idle';private disposed=false;private playing=false;private buffering=false;private operation=new AbortController();private epoch=0;
 private raf?:number;private position=0;private anchorPosition=0;private anchorWall=0;private anchorAudio=0;private metricsAt=0;
 private stats:PreviewMetrics={displayedFrames:0,droppedOutputFrames:0,decoderDroppedFrames:0,drawCalls:0,textureUploads:0,framebufferPasses:0,transitionDraws:0,framebufferCount:0,framebufferBytes:0,framebufferAllocations:0,lastCpuMs:0,meanCpuMs:0,lastDecodeWaitMs:0,maxSourceDriftMs:0,lastPresentedFrame:-1,activeMedia:0,cachedMedia:0,contextLosses:0};
 private lost=(event:Event)=>{event.preventDefault();if(this.disposed)return;this.stats.contextLosses++;this.stopTransport();this.epoch++;this.operation.abort();this.compositor.abandon();this.setState('context-lost');};
 private restored=()=>{if(this.disposed)return;try{this.compositor.dispose();this.compositor=new WebGLCompositor(this.canvas);this.resize();this.error=undefined;this.setState('paused');void this.seek(this.position).catch(e=>this.fail(e));}catch(e){this.fail(e);}};
 constructor(canvas:HTMLCanvasElement,options:GpuPreviewOptions){
  this.canvas=canvas;this.options=options;
  this.compositor=new WebGLCompositor(canvas);this.resize();canvas.addEventListener('webglcontextlost',this.lost);canvas.addEventListener('webglcontextrestored',this.restored);
 }
 get manifest():PreviewManifest{
  let dropped=this.stats.decoderDroppedFrames;for(const r of this.resources.values())dropped+=r.quality()?.droppedVideoFrames||0;
  const unavailable=this.error||(this.status==='context-lost'?{code:'GPU_CONTEXT_LOST',message:'图形上下文正在恢复。'}:undefined);
  const support=unavailable?{...this.support,supported:false,reasons:[...this.support.reasons,unavailable]}:this.support;
  return {backend:'webgl2',state:this.status,support:{...support,reasons:support.reasons.map(r=>({...r}))},renderer:{...this.compositor.info},color:this.compositor.colorState,time:this.currentTime,
   audioState:this.audio.state,metrics:{...this.stats,decoderDroppedFrames:dropped,lastGpuMs:this.compositor.lastGpuMs,cachedMedia:this.resources.size,framebufferCount:this.compositor.framebufferCount,framebufferBytes:this.compositor.framebufferBytes,framebufferAllocations:this.compositor.framebufferAllocations},
   decoders:[...this.resources.values()].map(r=>({clipId:r.id,state:r.state,currentTime:r.media?.currentTime,decodedMediaTime:r.decodedTime,readyState:r.media?.readyState,presentedFrames:r.presentedFrames,...(r.error?{error:r.error}:{})})),...(this.error?{error:{...this.error}}:{})};
 }
 get currentTime(){return this.playing?Math.min(this.plan?.duration??0,this.clockTime()):this.position;}
 private clockTime(){return this.buffering?this.position:this.anchorPosition+(this.audio.state==='running'?this.audio.currentTime-this.anchorAudio:(performance.now()-this.anchorWall)/1000);}
 private anchor(time:number){this.position=time;this.anchorPosition=time;this.anchorWall=performance.now();this.anchorAudio=this.audio.currentTime;}
 private setState(state:PreviewState){if(this.status!==state){this.status=state;this.options.onState?.(this.manifest);}}
 private resize(){const c=this.plan?.document.canvas||{width:1280,height:720},factor=Math.min(1,(this.options.maxDimension??1280)/Math.max(c.width,c.height),this.compositor.info.maxTextureSize/Math.max(c.width,c.height));
  this.compositor.resize(Math.max(2,Math.round(c.width*factor/2)*2),Math.max(2,Math.round(c.height*factor/2)*2));}
 private clearResources(){for(const id of [...this.resources.keys()])this.release(id);}
 private release(id:string){const r=this.resources.get(id);if(!r)return;this.stats.decoderDroppedFrames+=r.quality()?.droppedVideoFrames||0;this.audio.release(id);r.dispose();this.resources.delete(id);this.compositor.release(id);}
 private beginOperation(){this.operation.abort();this.operation=new AbortController();return {epoch:++this.epoch,signal:this.operation.signal};}
 private current(epoch:number){return !this.disposed&&epoch===this.epoch&&!this.operation.signal.aborted;}
 private ensure(){if(this.disposed)throw Error('PREVIEW_DISPOSED');if(this.status==='context-lost')throw Error('GPU_CONTEXT_LOST');}
 async setDocument(document:Document,options:{diagnostics?:Diagnostic[];time?:number;textContext?:TextContext}={}):Promise<PreviewManifest>{
  this.ensure();this.stopTransport();this.beginOperation();this.clearResources();this.plan=undefined;this.error=undefined;
  this.textContext=options.textContext;this.curveClocks.clear();
  const result=createPreviewPlan(document,{diagnostics:options.diagnostics,maxConcurrentMedia:this.options.maxConcurrentMedia,texturesAvailable:!!this.options.textTexture&&!!this.textContext});this.support=result.support;this.plan=result.plan;
  this.stats.lastPresentedFrame=-1;this.position=Math.min(Math.max(0,options.time??this.position),this.plan?.duration??0);this.resize();
  if(!this.plan){this.compositor.draw([],this.resources,document.canvas);this.setState('fallback');return this.manifest;}
  for(const {clip} of this.plan.media)if(clip.speedCurve)this.curveClocks.set(clip.id,createCurveClock(clip));
  this.setState('loading');return this.seek(this.position);
 }
 private displayFrame(time:number|Rational):PlannedFrame{
  const plan=this.plan!,seconds=typeof time==='number'?time:toNumber(time),last=frameTime(plan.frameCount-1,plan.document.fps);
  const at=seconds>=plan.duration?last:outputTime(time,plan.document.fps);return previewFrame(plan,at);
 }
 async seek(time:number|Rational):Promise<PreviewManifest>{
  this.ensure();this.stopTransport();if(!this.plan||!this.support.supported)return this.manifest;
  const op=this.beginOperation(),raw=typeof time==='number'?time:toNumber(time);this.position=Math.max(0,Math.min(Number.isFinite(raw)?raw:0,this.plan.duration));
  const frame=this.displayFrame(this.position);this.setState('loading');
  try{await this.prepare(frame,true,false,op.signal);if(!this.current(op.epoch))return this.manifest;
   // Let the browser finish the paused decoded frame before uploading it as a texture.
   await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));if(!this.current(op.epoch))return this.manifest;
   this.paint(frame,false);this.setState('ready');return this.manifest;
  }catch(e){if(!aborted(e)&&this.current(op.epoch))this.fail(e);return this.manifest;}
 }
 /** Call from the actual transport-button gesture so audio resume is authorized by browser policy. */
 async play(from?:number):Promise<void>{
  this.ensure();if(!this.plan||!this.support.supported||this.error)return;this.stopTransport(false);
  const op=this.beginOperation(),start=from??(this.position>=this.plan.duration?0:this.position),frame=this.displayFrame(start);
  this.position=toNumber(frame.time);this.setState('buffering');
  try{
   if(this.plan.audio.length)await this.audio.start();if(!this.current(op.epoch))return;
   await this.prepare(frame,true,true,op.signal);if(!this.current(op.epoch))return;
   this.anchor(toNumber(frame.time));this.playing=true;this.syncAudio(frame,this.position);this.paint(frame,false);this.setState('playing');this.raf=requestAnimationFrame(()=>{void this.tick(op.epoch);});
  }catch(e){if(!aborted(e)&&this.current(op.epoch))this.fail(e);}
 }
 pause(){if(this.disposed)return;this.stopTransport();this.beginOperation();if(this.status!=='fallback'&&this.status!=='context-lost')this.setState('paused');}
 /** Explicit developer/user diagnostic only. Pauses, bounds readback to 16 points and restores normal paint. */
 async diagnoseColor(points?:PixelPoint[],compareUnpack=false):Promise<PreviewColorDiagnostic>{
  this.ensure();this.pause();await this.seek(this.position);if(!this.plan||this.status==='fallback')throw Error('GPU_DIAGNOSTIC_PREVIEW_UNAVAILABLE');
  const frame=this.displayFrame(this.position),samplePoints=points??[{x:Math.floor(this.canvas.width/2),y:Math.floor(this.canvas.height/2)}];
  const sources=frame.media.map(l=>decodedColorSample(this.resources.get(l.clip.id)!)).filter((s):s is DecodedColorSample=>!!s);
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
  if(!this.playing||this.buffering)return;this.position=toNumber(frame.time);this.buffering=true;
  for(const r of this.resources.values())r.pause();this.audio.silence();this.setState('buffering');
 }
 private async prepare(frame:PlannedFrame,seekAll:boolean,play:boolean,signal:AbortSignal):Promise<boolean>{
  const started=performance.now(),activeIds=new Set(frame.media.map(l=>l.clip.id));let synchronized=seekAll;
  for(const [id,r] of this.resources)if(!activeIds.has(id))r.pause();
  const requested=await Promise.all(frame.media.map(async layer=>{
   let r=this.resources.get(layer.clip.id);let url=layer.asset.kind==='text'?r?.url:this.options.mediaUrl(layer.asset),asset=layer.asset;
   if(layer.asset.kind==='text'&&!r){
    if(!this.options.textTexture||!this.textContext)throw Error('GPU_TEXT_TEXTURE_SERVICE_REQUIRED');
    const texture=await this.options.textTexture(layer.clip.id,this.textContext,signal);if(signal.aborted)throw new DOMException('Aborted','AbortError');
    if(texture.width!==this.plan!.document.canvas.width||texture.height!==this.plan!.document.canvas.height)throw Error('GPU_TEXT_TEXTURE_DIMENSIONS_INVALID');
    asset={...asset,width:texture.width,height:texture.height};url=texture.url;
   }
   if(!url)throw Error('GPU_REGISTERED_MEDIA_URL_REQUIRED');
   if(r&&(r.asset.id!==layer.asset.id||r.url!==url)){this.release(r.id);r=undefined;}
   if(signal.aborted)throw new DOMException('Aborted','AbortError');
   if(!r){r=new DecodedMedia(layer.clip.id,asset,url,10000,{textRaster:asset.kind==='text'});this.resources.set(r.id,r);synchronized=true;}
   r.lastUsed=performance.now();if(r.state==='loading')synchronized=true;return {layer,resource:r};
  }));
  if(play&&synchronized)this.holdForBuffer(frame);
  await Promise.all(requested.map(async({layer,resource})=>{
   await resource.ready;if(signal.aborted)throw new DOMException('Aborted','AbortError');if(resource.state==='error')throw Error(resource.error);
   const media=resource.media;if(!media)return;
   const target=sourceSeekTime(layer.clip,layer.asset,frame.time,this.plan!.document.fps),speed=this.curveClocks.get(layer.clip.id)?.sample(frame.time).playbackRate??toNumber(layer.clip.speed);
   const drift=this.curveClocks.get(layer.clip.id)?.targetDrift(media.currentTime,frame.time)??Math.abs(media.currentTime-target)/speed;
   if(this.playing&&!this.buffering&&!media.paused)this.stats.maxSourceDriftMs=Math.max(this.stats.maxSourceDriftMs,drift*1000);
   if(layer.clip.speedCurve){
    // Variable playbackRate alone can decode the wrong source frame. Silent curves
    // use the authoritative per-output-frame source seek and remain paused. The
    // transport clock is not reanchored for every seek; late frames remain measurable.
    await resource.seek(target,signal);
    if(play&&!seekAll)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   }else if(seekAll||media.paused||media.readyState<2||drift>Math.max(.08,2/toNumber(this.plan!.document.fps))){synchronized=true;if(play)this.holdForBuffer(frame);await resource.seek(target,signal);}
   media.playbackRate=speed;media.preservesPitch=true;
  }));
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(play){if(synchronized)this.syncAudio(frame,toNumber(frame.time));await Promise.all(requested.map(({layer,resource})=>!layer.clip.speedCurve&&resource.media?.paused?resource.media.play():undefined));}
  this.stats.lastDecodeWaitMs=performance.now()-started;this.stats.activeMedia=activeIds.size;
  const inactive=[...this.resources.values()].filter(r=>!activeIds.has(r.id)).sort((a,b)=>a.lastUsed-b.lastUsed);
  while(this.resources.size>(this.options.maxCachedMedia??24)&&inactive.length)this.release(inactive.shift()!.id);
  return synchronized;
 }
 private syncAudio(frame:PlannedFrame,time:number){
  this.audio.sync(frame.audio.map(({clip})=>({id:clip.id,clip,element:this.resources.get(clip.id)!.media!})),time);
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
   const synced=await this.prepare(frame,false,true,this.operation.signal);if(!this.playing||!this.current(epoch))return;
   if(synced){this.anchor(toNumber(frame.time));this.buffering=false;this.setState('playing');}this.syncAudio(frame,this.currentTime);
   if(frame.frame!==this.stats.lastPresentedFrame)this.paint(frame,true);
   this.options.onTime?.(this.currentTime);this.raf=requestAnimationFrame(()=>{void this.tick(epoch);});
  }catch(e){if(!aborted(e)&&this.current(epoch))this.fail(e);}
 }
 private fail(e:unknown){
  this.stopTransport();this.operation.abort();this.error={code:(e as Error)?.message?.split(':')[0]||'GPU_PREVIEW_FAILED',message:(e as Error)?.message||String(e)};this.setState('fallback');
 }
 dispose(options:{releaseContext?:boolean}={}){
  if(this.disposed)return;this.stopTransport();this.operation.abort();this.epoch++;this.canvas.removeEventListener('webglcontextlost',this.lost);this.canvas.removeEventListener('webglcontextrestored',this.restored);
  this.clearResources();this.audio.dispose();this.compositor.dispose(options.releaseContext);this.disposed=true;this.setState('disposed');
 }
}
