import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuPreview} from '../apps/editor/src/preview/index.ts';
import {CurveSounds} from '../apps/editor/src/preview/curve-sound.ts';
import {createPreviewPlan} from '../apps/editor/src/preview/plan.ts';
import {emptyDocument} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';

// Exercise the real preparation/transport/decoder code without a GL context.
// The video stays loading until the test sends an actual error or abort event.
class PendingVideo extends EventTarget{
 src='';muted=true;volume=1;preservesPitch=true;playsInline=true;paused=true;removed=false;
 load(){}pause(){this.paused=true;}removeAttribute(){this.src='';}remove(){this.removed=true;}
}
function harness(sounds:CurveSounds){
 const doc=emptyDocument();doc.assets=[{id:'v',kind:'video',path:'/registered.mp4',duration:rational(2),width:320,height:180,hasAudio:true}];
 doc.tracks[0].clips=[{id:'c',materialId:'v',source:{start:rational(0),duration:rational(1)},target:{start:rational(0),duration:rational(1)},speed:rational(1),editableTiming:true,speedCurve:{points:[{x:0,y:1},{x:1,y:1}]}}];
 const preview=Object.create(GpuPreview.prototype) as GpuPreview;
 Object.assign(preview,{
  plan:createPreviewPlan(doc,{curveAudioAvailable:true}).plan,support:{supported:true,reasons:[]},resources:new Map(),sounds,canvas:new EventTarget(),
  textContext:{projectId:'p',revision:0},options:{mediaUrl:(a:{id:string})=>'http://127.0.0.1/media/'+a.id},curveClocks:new Map(),
  status:'ready',disposed:false,playing:false,buffering:false,epoch:0,position:0,operation:new AbortController(),stats:{decoderDroppedFrames:0},
  audio:{silence(){},async suspend(){},release(){},dispose(){}},compositor:{release(){},dispose(){}},
  setState(this:{status:string},state:string){this.status=state;},
 });
 Object.defineProperty(preview,'manifest',{get(this:{status:string;error?:{code:string}}){return {state:this.status,error:this.error};}});
 return preview;
}
const settled=()=>new Promise<void>(resolve=>setImmediate(()=>setImmediate(resolve)));
async function environment(run:(videos:PendingVideo[],unhandled:unknown[])=>Promise<void>){
 const original={document:globalThis.document,HTMLVideoElement:globalThis.HTMLVideoElement},videos:PendingVideo[]=[],unhandled:unknown[]=[],listener=(reason:unknown)=>{unhandled.push(reason);};
 Object.assign(globalThis,{document:{createElement:()=>{const video=new PendingVideo();videos.push(video);return video;}},HTMLVideoElement:PendingVideo});process.on('unhandledRejection',listener);
 try{await run(videos,unhandled);}finally{process.removeListener('unhandledRejection',listener);Object.assign(globalThis,original);}
}
test('PCM failure remains observable and a subsequent video decode error is never an unhandled rejection',async()=>environment(async(videos,unhandled)=>{
 const preview=harness(new CurveSounds(async()=>{throw Error('GPU_CURVE_AUDIO_SERVICE_UNAVAILABLE');}));
 try{
  const manifest=await preview.seek(0);assert.equal(manifest.state,'fallback');assert.equal(manifest.error?.code,'GPU_CURVE_AUDIO_SERVICE_UNAVAILABLE');assert.equal(videos.length,1);
  videos[0].dispatchEvent(new Event('error'));await settled();assert.deepEqual(unhandled,[],'a sidecar failure must not leave decoder.ready unobserved');
  assert.equal(preview.manifest.error?.code,'GPU_CURVE_AUDIO_SERVICE_UNAVAILABLE','late decoder failure must not replace the original fallback error');
 }finally{preview.dispose();await settled();}
}));
test('cancelling and disposing while PCM/video are loading observes decoder AbortError and cannot revive the preview',async()=>environment(async(videos,unhandled)=>{
 let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
 const sounds=new CurveSounds((_id,_context,signal)=>new Promise((_resolve,reject)=>{entered();signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});})),preview=harness(sounds);
 const pending=preview.seek(0);await started;assert.equal(videos.length,1);preview.dispose();const manifest=await pending;await settled();
 assert.equal(manifest.state,'disposed');assert.equal(manifest.error,undefined);assert.equal(videos[0].removed,true);assert.equal(videos[0].src,'');assert.equal(sounds.size,0);assert.deepEqual(unhandled,[],'dispose must observe the loading decoder rejection even when PCM prepare aborts first');
 videos[0].dispatchEvent(new Event('error'));await settled();assert.equal(preview.manifest.state,'disposed');assert.deepEqual(unhandled,[]);
}));
