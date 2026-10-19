import type {Clip} from '../../../../packages/core/src/document.ts';
import {sourceTimeAt,evaluateAnimation} from '../../../../packages/core/src/animation.ts';
import {decimal,toNumber} from '../../../../packages/core/src/time.ts';

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
type NodeRoute={element:HTMLMediaElement;source:MediaElementAudioSourceNode;gain:GainNode};
// cancelScheduledValues(now) leaves a curve that started before now active. Cancel
// that curve too before replacing the lookahead window (or silencing a route).
function replaceEnvelope(param:AudioParam,now:number,value:number){
 if(typeof param.cancelAndHoldAtTime==='function')param.cancelAndHoldAtTime(now);else param.cancelScheduledValues(0);
 param.setValueAtTime(value,now);
}
export class PreviewAudio {
 private context?:AudioContext;private routes=new Map<string,NodeRoute>();private disposed=false;
 get state():AudioContextState|'uninitialized' {return this.context?.state??'uninitialized';}
 get currentTime(){return this.context?.currentTime??0;}
 /** Must be called directly from a user initiated play action, never while loading/seek. */
 async start(){
  if(this.disposed)throw Error('PREVIEW_DISPOSED');
  if(!this.context){if(typeof AudioContext==='undefined')throw Error('WEB_AUDIO_UNAVAILABLE');this.context=new AudioContext({latencyHint:'interactive'});}
  await this.context.resume();if(this.context.state!=='running')throw Error('AUDIO_CONTEXT_SUSPENDED');
 }
 sync(active:AudioRoute[],targetSeconds:number){
  const context=this.context;if(!context||context.state!=='running')return;
  const activeIds=new Set(active.map(a=>a.id)),now=context.currentTime;
  for(const [id,route] of this.routes)if(!activeIds.has(id)){route.element.muted=true;replaceEnvelope(route.gain.gain,now,0);}
  for(const route of active){
   let node=this.routes.get(route.id);
   if(node&&node.element!==route.element){this.release(route.id);node=undefined;}
   if(!node){const source=context.createMediaElementSource(route.element),gain=context.createGain();gain.gain.value=0;source.connect(gain);gain.connect(context.destination);node={element:route.element,source,gain};this.routes.set(route.id,node);}
   route.element.muted=false;route.element.volume=1;
   // Schedule a short overlapping window on the audio clock, avoiding RAF-sized step changes.
   const window=.12,values=new Float32Array(128);for(let i=0;i<values.length;i++)values[i]=audioGainAt(route.clip,targetSeconds+window*i/(values.length-1));
   replaceEnvelope(node.gain.gain,now,values[0]);node.gain.gain.setValueCurveAtTime(values,now,window);
  }
 }
 silence(){if(!this.context)return;const now=this.context.currentTime;for(const r of this.routes.values()){r.element.muted=true;replaceEnvelope(r.gain.gain,now,0);}}
 release(id:string){const r=this.routes.get(id);if(!r)return;r.element.muted=true;r.source.disconnect();r.gain.disconnect();this.routes.delete(id);}
 async suspend(){this.silence();if(this.context?.state==='running')await this.context.suspend();}
 dispose(){if(this.disposed)return;this.disposed=true;this.silence();for(const id of this.routes.keys())this.release(id);if(this.context)void this.context.close().catch(()=>{});}
}
