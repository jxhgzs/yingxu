import type {Clip} from '../../../../packages/core/src/document.ts';
import {sourceTimeAt,evaluateAnimation} from '../../../../packages/core/src/animation.ts';
import {decimal,toNumber} from '../../../../packages/core/src/time.ts';
import type {CurvePcm} from './curve-pcm.ts';

/** Same source-clock volume and target-clock qsin envelope as the native render graph. */
export function audioGainAt(clip:Clip,targetSeconds:number):number{
 const start=toNumber(clip.target.start),length=toNumber(clip.target.duration),elapsed=targetSeconds-start;
 if(elapsed<0||elapsed>=length||clip.muted)return 0;
 const animation=clip.animations?.find(a=>a.property==='volume');
 const gain=animation?evaluateAnimation(animation,sourceTimeAt(clip,decimal(Math.max(0,targetSeconds).toFixed(9)))):clip.volume??1;
 const a=clip.audioFade?toNumber(clip.audioFade.inDuration):0,b=clip.audioFade?toNumber(clip.audioFade.outDuration):0;
 return gain*(a>0?Math.sin(Math.min(1,elapsed/a)*Math.PI/2):1)*(b>0?Math.sin(Math.min(1,(length-elapsed)/b)*Math.PI/2):1);
}
export type AudioRoute={id:string;element:HTMLMediaElement;clip:Clip};
export type CurveAudioRoute={id:string;clip:Clip;pcm:CurvePcm};
type NodeRoute={element:HTMLMediaElement;source:MediaElementAudioSourceNode;gain:GainNode};
type BufferRoute={pcm:CurvePcm;buffer:AudioBuffer;gain:GainNode;source?:AudioBufferSourceNode;offset:number;startedAt:number;expectedOffset:number};
// Replace the full automation timeline with the explicitly evaluated gain.
// Chromium can retain a shortened active curve after cancelAndHoldAtTime(now),
// rejecting a new curve at that same audio-clock instant during frame buffering.
function replaceEnvelope(param:AudioParam,now:number,value:number){
 param.cancelScheduledValues(0);
 param.setValueAtTime(value,now);
}
function scheduleEnvelope(param:AudioParam,clip:Clip,targetSeconds:number,now:number){
 const window=.12,values=new Float32Array(128);for(let i=0;i<values.length;i++)values[i]=audioGainAt(clip,targetSeconds+window*i/(values.length-1));
 replaceEnvelope(param,now,values[0]);param.setValueCurveAtTime(values,now,window);
}
export class PreviewAudio {
 private context?:AudioContext;private routes=new Map<string,NodeRoute>();private buffers=new Map<string,BufferRoute>();private disposed=false;
 get state():AudioContextState|'uninitialized' {return this.context?.state??'uninitialized';}
 get currentTime(){return this.context?.currentTime??0;}
 /** Scheduling-clock measurements; these do not measure speaker/output latency. */
 get curveRoutes(){
  const now=this.currentTime;
  return [...this.buffers].filter(([,r])=>r.source).map(([id,r])=>{const actualOffset=Math.min(r.buffer.duration,r.offset+Math.max(0,now-r.startedAt));return {id,offset:r.offset,startedAt:r.startedAt,expectedOffset:r.expectedOffset,actualOffset,driftMs:(actualOffset-r.expectedOffset)*1000};});
 }
 /** Must be called directly from a user initiated play action, never while loading/seek. */
 async start(){
  if(this.disposed)throw Error('PREVIEW_DISPOSED');
  if(!this.context){if(typeof AudioContext==='undefined')throw Error('WEB_AUDIO_UNAVAILABLE');this.context=new AudioContext({latencyHint:'interactive'});}
  await this.context.resume();if(this.context.state!=='running')throw Error('AUDIO_CONTEXT_SUSPENDED');
 }
 sync(active:AudioRoute[],targetSeconds:number,curves:CurveAudioRoute[]=[]){
  // A curved video's media element must stay silent even before permission to
  // start Web Audio. Only its independently stretched target-clock PCM is heard.
  const curveIds=new Set(curves.map(r=>r.id));for(const route of active)if(curveIds.has(route.id))route.element.muted=true;
  const context=this.context;if(!context||context.state!=='running')return;
  if(this.disposed)throw Error('PREVIEW_DISPOSED');
  if(!Number.isFinite(targetSeconds))throw Error('AUDIO_TARGET_TIME_INVALID');
  const activeIds=new Set(active.filter(a=>!curveIds.has(a.id)).map(a=>a.id)),now=context.currentTime;
  for(const [id,route] of this.routes)if(!activeIds.has(id)){route.element.muted=true;replaceEnvelope(route.gain.gain,now,0);}
  for(const id of this.buffers.keys())if(!curveIds.has(id))this.releaseBuffer(id);
  for(const route of active){
   if(curveIds.has(route.id))continue;
   let node=this.routes.get(route.id);
   if(node&&node.element!==route.element){this.release(route.id);node=undefined;}
   if(!node){const source=context.createMediaElementSource(route.element),gain=context.createGain();gain.gain.value=0;source.connect(gain);gain.connect(context.destination);node={element:route.element,source,gain};this.routes.set(route.id,node);}
   route.element.muted=false;route.element.volume=1;
   // Schedule a short overlapping window on the audio clock, avoiding RAF-sized step changes.
   scheduleEnvelope(node.gain.gain,route.clip,targetSeconds,now);
  }
  for(const route of curves){
   const elapsed=targetSeconds-toNumber(route.clip.target.start),length=toNumber(route.clip.target.duration);
   let node=this.buffers.get(route.id);
   if(node&&node.pcm!==route.pcm){this.releaseBuffer(route.id);node=undefined;}
   if(elapsed<0||elapsed>=length||elapsed>=route.pcm.sampleCount/route.pcm.sampleRate||route.clip.muted){if(node)this.stopBuffer(node,now);continue;}
   if(!node){
    const pcm=route.pcm;if(pcm.sampleRate!==44100||pcm.sampleCount<1||pcm.channels.length!==2||pcm.channels.some(c=>c.length!==pcm.sampleCount))throw Error('CURVE_PCM_INVALID');
    const buffer=context.createBuffer(2,pcm.sampleCount,pcm.sampleRate);buffer.getChannelData(0).set(pcm.channels[0]);buffer.getChannelData(1).set(pcm.channels[1]);
    const gain=context.createGain();gain.gain.value=0;gain.connect(context.destination);
    node={pcm,buffer,gain,offset:0,startedAt:0,expectedOffset:0};this.buffers.set(route.id,node);
   }
   node.expectedOffset=Math.max(0,elapsed);
   if(!node.source){
    const source=context.createBufferSource();source.buffer=node.buffer;source.playbackRate.value=1;source.connect(node.gain);
    // Source audio has already been stretched. Use the target offset, never
    // sourceTimeAt or clip.speed, and rebuild this one-shot node after a seek.
    try{source.start(now,node.expectedOffset);}catch(error){source.disconnect();throw error;}
    node.source=source;node.offset=node.expectedOffset;node.startedAt=now;
   }
   scheduleEnvelope(node.gain.gain,route.clip,targetSeconds,now);
  }
 }
 private stopBuffer(route:BufferRoute,now:number){if(route.source){try{route.source.stop();}finally{route.source.disconnect();route.source=undefined;}}replaceEnvelope(route.gain.gain,now,0);}
 private releaseBuffer(id:string){const route=this.buffers.get(id);if(!route)return;this.stopBuffer(route,this.currentTime);route.gain.disconnect();this.buffers.delete(id);}
 silence(){if(!this.context)return;const now=this.context.currentTime;for(const r of this.routes.values()){r.element.muted=true;replaceEnvelope(r.gain.gain,now,0);}for(const r of this.buffers.values())this.stopBuffer(r,now);}
 release(id:string){const r=this.routes.get(id);if(r){r.element.muted=true;r.source.disconnect();r.gain.disconnect();this.routes.delete(id);}this.releaseBuffer(id);}
 async suspend(){this.silence();if(this.context?.state==='running')await this.context.suspend();}
 dispose(){if(this.disposed)return;this.disposed=true;this.silence();for(const id of this.routes.keys())this.release(id);for(const id of this.buffers.keys())this.releaseBuffer(id);if(this.context)void this.context.close().catch(()=>{});}
}
