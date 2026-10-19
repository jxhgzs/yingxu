import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewAudio} from '../apps/editor/src/preview/audio.ts';
import {WebGLCompositor} from '../apps/editor/src/preview/webgl.ts';
import {DecodedMedia} from '../apps/editor/src/preview/decode.ts';
import {GpuPreview} from '../apps/editor/src/preview/index.ts';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import type {PlannedVisual} from '../apps/editor/src/preview/plan.ts';
import {rational} from '../packages/core/src/time.ts';
import type {Clip} from '../packages/core/src/document.ts';
import type {Asset} from '../packages/core/src/document.ts';

class Envelope {
 value=0;end=0;last=0;holds=0;clears=0;
 // Model Chromium's retained, shortened curve at a buffering boundary.
 cancelAndHoldAtTime(now:number){this.holds++;this.end=now+.005333333333333329;}
 cancelScheduledValues(now:number){if(now===0){this.end=0;this.clears++;}}
 setValueAtTime(value:number,now:number){assert(now>=this.end,'new event overlaps a previous active curve');this.last=value;}
 setValueCurveAtTime(values:Float32Array,now:number,length:number){assert(now>=this.end,'lookahead curves overlap');this.last=values[0];this.end=now+length;}
}
class AudioNodeFake { disconnected=false;connect(){}disconnect(){this.disconnected=true;} }
class GainFake extends AudioNodeFake {gain=new Envelope();}
class AudioFake {
 static count=0;static latest:AudioFake;state='suspended';currentTime=0;destination={};sources:AudioNodeFake[]=[];gains:GainFake[]=[];
 constructor(){AudioFake.count++;AudioFake.latest=this;}
 async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
 createMediaElementSource(){const node=new AudioNodeFake();this.sources.push(node);return node;}
 createGain(){const node=new GainFake();this.gains.push(node);return node;}
}
const clip:Clip={id:'c',materialId:'a',source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,volume:.5};

test('WebAudio stays lazy, replaces active envelopes and releases every route',async()=>{
 const original=globalThis.AudioContext;Object.assign(globalThis,{AudioContext:AudioFake});
 try{
  const audio=new PreviewAudio(),element={muted:true,volume:1} as HTMLMediaElement,active=[{id:'c',element,clip}];
  const before=AudioFake.count;audio.sync(active,0);assert.equal(AudioFake.count,before);assert.equal(audio.state,'uninitialized');
  await audio.start();const context=AudioFake.latest;audio.sync(active,0);assert.equal(context.sources.length,1);assert.equal(element.muted,false);assert.equal(context.gains[0].gain.last,.5);
  context.currentTime=.02;audio.sync(active,.02);assert.equal(context.sources.length,1,'a media element must be connected only once');assert.equal(context.gains[0].gain.clears,2);assert.equal(context.gains[0].gain.holds,0);
  // Frame preparation may reschedule at the identical AudioContext time.
  for(let i=0;i<20;i++){audio.sync(active,.02);audio.silence();audio.sync(active,.02);}
  assert.equal(context.sources.length,1);assert.equal(context.gains[0].gain.last,.5);
  audio.silence();assert.equal(context.gains[0].gain.last,0);assert.equal(element.muted,true);
  await audio.suspend();assert.equal(audio.state,'suspended');audio.dispose();audio.dispose();
  assert(context.sources.every(n=>n.disconnected));assert(context.gains.every(n=>n.disconnected));assert.equal(audio.state,'closed');
 }finally{Object.assign(globalThis,{AudioContext:original});}
});
test('audio resume denial is observable and cannot unmute media',async()=>{
 const original=globalThis.AudioContext;
 class Blocked extends AudioFake {override async resume(){} }
 Object.assign(globalThis,{AudioContext:Blocked});
 try{const audio=new PreviewAudio();await assert.rejects(audio.start(),/AUDIO_CONTEXT_SUSPENDED/);assert.equal(audio.state,'suspended');audio.dispose();}
 finally{Object.assign(globalThis,{AudioContext:original});}
});

function glFixture(failure?:'compile'|'link'|'uniform'|'framebuffer'){
 const live={shaders:new Set(),programs:new Set(),buffers:new Set(),vaos:new Set(),textures:new Set(),framebuffers:new Set()},alloc=(set:Set<unknown>)=>{const object={};set.add(object);return object;};
 let boundFramebuffer:unknown=null;const draws:{framebuffer:unknown;opacity?:number;progress?:number;dip:boolean}[]=[],clears:{framebuffer:unknown;alpha:number}[]=[],reads:{x:number;y:number;framebuffer:unknown}[]=[],pixelStores=new Map<number,unknown>([[40,41]]);let opacity:number|undefined,progress:number|undefined,alpha=1,dip=false;
 const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,FLOAT:6,BLEND:7,ONE:8,ONE_MINUS_SRC_ALPHA:9,DEPTH_TEST:10,UNPACK_FLIP_Y_WEBGL:11,UNPACK_PREMULTIPLY_ALPHA_WEBGL:12,RENDERER:13,VENDOR:14,MAX_TEXTURE_SIZE:15,
  createShader:()=>alloc(live.shaders),shaderSource(){},compileShader(){},getShaderParameter:()=>failure!=='compile',getShaderInfoLog:()=> 'test compile error',deleteShader:(v:unknown)=>live.shaders.delete(v),
  createProgram:()=>alloc(live.programs),attachShader(){},linkProgram(){},getProgramParameter:()=>failure!=='link',getProgramInfoLog:()=> 'test link error',deleteProgram:(v:unknown)=>live.programs.delete(v),
  createBuffer:()=>alloc(live.buffers),createVertexArray:()=>alloc(live.vaos),deleteBuffer:(v:unknown)=>live.buffers.delete(v),deleteVertexArray:(v:unknown)=>live.vaos.delete(v),bindVertexArray(){},bindBuffer(){},getAttribLocation:()=>0,enableVertexAttribArray(){},vertexAttribPointer(){},useProgram(){},getUniformLocation:(_p:unknown,name:string)=>failure==='uniform'?null:{name},uniform1i:(location:{name:string},value:number)=>{if(location.name==='u_dipToBlack')dip=!!value;},uniform4iv(){},uniform4fv(){},uniformMatrix3fv(){},enable(){},blendFunc(){},disable(){},pixelStorei:(name:number,value:unknown)=>pixelStores.set(name,value),getExtension:()=>null,getParameter:(p:number)=>p===40?pixelStores.get(p):p===15?4096:p===13?'Test hardware renderer':'Test vendor',viewport(){},isContextLost:()=>false,
  UNPACK_COLORSPACE_CONVERSION_WEBGL:40,BROWSER_DEFAULT_WEBGL:41,NONE:0,drawingBufferColorSpace:'display-p3',unpackColorSpace:'display-p3',
  clearColor:(_r:number,_g:number,_b:number,a:number)=>{alpha=a;},clear:()=>clears.push({framebuffer:boundFramebuffer,alpha}),activeTexture(){},
  FRAMEBUFFER:30,COLOR_ATTACHMENT0:31,FRAMEBUFFER_COMPLETE:32,TEXTURE0:33,TEXTURE_2D:34,RGBA8:35,RGBA:36,UNSIGNED_BYTE:37,NO_ERROR:0,
  createTexture:()=>alloc(live.textures),deleteTexture:(v:unknown)=>live.textures.delete(v),bindTexture(){},texParameteri(){},texImage2D(){},getError:()=>0,
  createFramebuffer:()=>alloc(live.framebuffers),deleteFramebuffer:(v:unknown)=>live.framebuffers.delete(v),bindFramebuffer:(_target:number,framebuffer:unknown)=>{boundFramebuffer=framebuffer;},framebufferTexture2D(){},checkFramebufferStatus:()=>failure==='framebuffer'?0:32,
  bufferData(){},uniform1f:(location:{name:string},value:number)=>{if(location.name==='u_opacity')opacity=value;if(location.name==='u_progress')progress=value;},drawArrays:()=>draws.push({framebuffer:boundFramebuffer,opacity,progress,dip}),
  readPixels:(x:number,y:number,_w:number,_h:number,_format:number,_type:number,data:Uint8Array)=>{reads.push({x,y,framebuffer:boundFramebuffer});data.set([pixelStores.get(40)===41?100:99,20,30,255]);}};
 const canvas=Object.assign(new EventTarget(),{getContext:(name:string)=>{assert.equal(name,'webgl2');return gl;},width:0,height:0}) as unknown as HTMLCanvasElement;
 return {canvas,live,draws,clears,reads,pixelStores,gl};
}
test('shader compilation/link/initialization errors free all partial allocations',()=>{
 for(const failure of ['compile','link','uniform'] as const){const {canvas,live}=glFixture(failure);assert.throws(()=>new WebGLCompositor(canvas),/GPU_/);for(const set of Object.values(live))assert.equal(set.size,0,`${failure} leaked an allocation`);}
 const {canvas,live}=glFixture(),compositor=new WebGLCompositor(canvas);assert.equal(compositor.info.softwareRenderer,false);assert.equal(live.shaders.size,0);compositor.dispose();compositor.dispose();for(const set of Object.values(live))assert.equal(set.size,0);
});
test('dip midpoint emits opaque black without requiring either zero-weight decoder',()=>{
 const {canvas,live,draws,clears}=glFixture(),compositor=new WebGLCompositor(canvas);compositor.resize(320,180);
 const layer:PlannedVisual={clip,asset:{id:'a',kind:'video',path:'',duration:rational(2),width:320,height:180},transform:{...defaultTransform(),opacity:.5},sourceTime:rational(2)};
 const pair={...layer,transition:{id:'dip',kind:'dipToBlack' as const,progress:.5,incoming:{...layer,clip:{...clip,id:'incoming'},sourceTime:rational(0)}}};
 const result=compositor.draw([pair],new Map(),{width:320,height:180});assert.deepEqual(result,{drawCalls:1,textureUploads:0,framebufferPasses:2,transitionDraws:1});assert.equal(draws[0].dip,true);assert.equal(draws[0].progress,.5);assert.equal(draws[0].framebuffer,null);assert.deepEqual(clears.filter(c=>c.framebuffer).map(c=>c.alpha),[0,0]);
 compositor.dispose();for(const set of Object.values(live))assert.equal(set.size,0);
});

test('crossfade renders two transparent isolated targets, reuses them and frees resize/failure allocations',()=>{
 const saved=globalThis.HTMLVideoElement;Object.assign(globalThis,{HTMLVideoElement:class {}});
 const layer=(id:string,opacity:number):PlannedVisual=>({clip:{...clip,id},asset:{id,kind:'image',path:'',duration:rational(2),width:32,height:32},transform:{...defaultTransform(),opacity},sourceTime:rational(0)});
 const lower=layer('lower',1),outgoing=layer('out',.25),incoming=layer('in',.5),upper=layer('upper',.75),pair={...outgoing,transition:{id:'crossfade',kind:'crossfade' as const,progress:.5,incoming}};
 const media=new Map([lower,outgoing,incoming,upper].map(l=>[l.clip.id,{id:l.clip.id,state:'ready',asset:l.asset,pixels:{naturalWidth:32,naturalHeight:32}} as unknown as DecodedMedia]));
 try{
  const {canvas,live,draws,clears,reads,pixelStores,gl}=glFixture(),compositor=new WebGLCompositor(canvas);compositor.resize(320,180);
  const result=compositor.draw([lower,pair,upper],media,{width:320,height:180});assert.deepEqual(result,{drawCalls:5,textureUploads:4,framebufferPasses:2,transitionDraws:1});
  assert.equal(draws[0].framebuffer,null);assert(draws[1].framebuffer);assert(draws[2].framebuffer);assert.notEqual(draws[1].framebuffer,draws[2].framebuffer);assert.equal(draws[3].framebuffer,null);assert.equal(draws[4].framebuffer,null);
  assert.equal(draws[1].opacity,.25);assert.equal(draws[2].opacity,.5);assert.equal(draws[3].progress,.5);assert.deepEqual(clears.filter(c=>c.framebuffer).map(c=>c.alpha),[0,0]);
  assert.equal(compositor.framebufferCount,2);assert.equal(compositor.framebufferBytes,320*180*4*2);assert.equal(compositor.framebufferAllocations,2);
  compositor.draw([pair],media,{width:320,height:180});assert.equal(compositor.framebufferAllocations,2,'steady playback allocated another pair of FBOs');
  const normal=compositor.diagnose([pair],media,{width:320,height:180},[{x:20,y:30}]);assert.equal(normal.state.drawingBufferColorSpace,'srgb');assert.equal(normal.state.unpackColorSpace,'srgb');assert.equal(normal.transitions.length,1);assert.equal(normal.transitions[0].outgoing[0].rgba[0],100);assert.equal(normal.final[0].rgba[0],100);
  const raw=compositor.diagnose([pair],media,{width:320,height:180},[{x:20,y:30}],'none');assert.equal(raw.state.unpackConversion,'none');assert.equal(raw.final[0].rgba[0],99);assert.equal(pixelStores.get(40),41,'diagnostic left NONE enabled');assert.equal(reads.length,6);assert(reads.every(r=>r.x===20&&r.y===149),'top-left diagnostic coordinate was not converted to GL bottom-left');
  assert.throws(()=>compositor.diagnose([pair],media,{width:320,height:180},[{x:320,y:0}]),/POINTS_INVALID/);assert.throws(()=>compositor.diagnose([pair],media,{width:320,height:180},Array.from({length:17},()=>({x:0,y:0}))),/POINTS_INVALID/);
  const readPixels=gl.readPixels;gl.readPixels=()=>{throw Error('test read failure');};assert.throws(()=>compositor.diagnose([pair],media,{width:320,height:180},[{x:0,y:0}],'none'),/test read failure/);assert.equal(pixelStores.get(40),41);compositor.draw([pair],media,{width:320,height:180});gl.readPixels=readPixels;
  compositor.resize(640,360);assert.equal(compositor.framebufferCount,0);assert.equal(live.framebuffers.size,0);compositor.draw([pair],media,{width:320,height:180});assert.equal(compositor.framebufferAllocations,4);compositor.dispose();for(const set of Object.values(live))assert.equal(set.size,0);
  const failure=glFixture('framebuffer'),failed=new WebGLCompositor(failure.canvas);failed.resize(320,180);assert.throws(()=>failed.draw([pair],media,{width:320,height:180}),/FRAMEBUFFER_INCOMPLETE/);assert.equal(failure.live.framebuffers.size,0);assert.equal(failure.live.textures.size,0);failed.dispose();for(const set of Object.values(failure.live))assert.equal(set.size,0);
 }finally{Object.assign(globalThis,{HTMLVideoElement:saved});}
});

test('context loss reports unsupported and restore redraws without resuming playback',async()=>{
 const saved={requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 Object.assign(globalThis,{requestAnimationFrame:(fn:FrameRequestCallback)=>{queueMicrotask(()=>fn(0));return 1;},cancelAnimationFrame:()=>{}});
 try{
  const {canvas,live}=glFixture();let invalidDeletes=0;
  for(const set of Object.values(live)){const remove=set.delete.bind(set);set.delete=(value)=>{if(!set.has(value))invalidDeletes++;return remove(value);};}
  // Real context loss invalidates every handle before restoration. Calling GL
  // delete on those obsolete objects then sets INVALID_OPERATION (1282).
  canvas.addEventListener('webglcontextlost',()=>{for(const set of Object.values(live))set.clear();});
  const preview=new GpuPreview(canvas,{mediaUrl:()=>{throw Error('hidden clip must not load media');}}),doc=emptyDocument();
  doc.assets.push({id:'v',kind:'video',path:'/never-open.mp4',duration:rational(2),width:320,height:180});doc.tracks[0].hidden=true;
  doc.tracks[0].clips.push({...clip,materialId:'v'});await preview.setDocument(doc);assert.equal(preview.manifest.state,'ready');assert.equal(preview.manifest.audioState,'uninitialized');
  const loss=new Event('webglcontextlost',{cancelable:true});canvas.dispatchEvent(loss);assert(loss.defaultPrevented);assert.equal(preview.manifest.state,'context-lost');assert.equal(preview.manifest.support.supported,false);
  canvas.dispatchEvent(new Event('webglcontextrestored'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(preview.manifest.state,'ready');assert.equal(preview.manifest.support.supported,true);assert.equal(preview.manifest.audioState,'uninitialized');
  assert.equal(invalidDeletes,0,'restoration deleted invalidated GL handles');preview.dispose();for(const set of Object.values(live))assert.equal(set.size,0);assert.equal(preview.manifest.state,'disposed');
 }finally{Object.assign(globalThis,saved);}
});

test('registered decoder waits for seek and cancels load/frame callbacks on dispose',async()=>{
 class VideoFake extends EventTarget {
  src='';crossOrigin='';preload='';muted=true;volume=1;preservesPitch=true;playsInline=true;duration=5;readyState=2;seeking=false;paused=true;removed=false;cancelled=false;at=0;
  get currentTime(){return this.at;}set currentTime(v:number){this.at=v;this.seeking=true;queueMicrotask(()=>{this.seeking=false;this.dispatchEvent(new Event('seeked'));});}
  load(){if(this.src)queueMicrotask(()=>this.dispatchEvent(new Event('loadeddata')));}
  pause(){this.paused=true;}requestVideoFrameCallback(){return 17;}cancelVideoFrameCallback(id:number){assert.equal(id,17);this.cancelled=true;}
  removeAttribute(name:string){assert.equal(name,'src');this.src='';}remove(){this.removed=true;}
 }
 const saved={document:globalThis.document,HTMLVideoElement:globalThis.HTMLVideoElement};
 Object.assign(globalThis,{document:{createElement:()=>new VideoFake()},HTMLVideoElement:VideoFake});
 const asset:Asset={id:'v',kind:'video',path:'/must-not-open-source.mp4',duration:rational(5),width:320,height:180};
 try{
  assert.throws(()=>new DecodedMedia('c',asset,'file:///must-not-open-source.mp4'),/REGISTERED_MEDIA_URL/);
  const decoder=new DecodedMedia('c',asset,'http://127.0.0.1:8826/media/v');await decoder.ready;assert.equal(decoder.state,'ready');
  await decoder.seek(2);assert.equal(decoder.media!.currentTime,2);decoder.dispose();decoder.dispose();assert.equal(decoder.state,'disposed');
  const element=decoder.element as unknown as VideoFake;assert(element.cancelled);assert(element.removed);assert.equal(element.src,'');assert.equal(element.paused,true);
  const cancelled=new DecodedMedia('pending',asset,'http://127.0.0.1:8826/media/v');cancelled.dispose();await assert.rejects(cancelled.ready,{name:'AbortError'});assert.equal(cancelled.state,'disposed');
 }finally{Object.assign(globalThis,saved);}
});

test('static text texture keeps asset identity, uploads once and does not apply its baked transform/opacity twice',()=>{
 const saved=globalThis.HTMLVideoElement;Object.assign(globalThis,{HTMLVideoElement:class {}});
 const asset:Asset={id:'text-asset',kind:'text',path:'',duration:rational(20)},layer:PlannedVisual={clip:{...clip,id:'text-clip',materialId:asset.id},asset,sourceTime:rational(0),transform:{...defaultTransform(),x:70,y:-10,scale:.5,rotation:25,opacity:.4}};
 const resource={id:'text-clip',state:'ready',asset:{...asset,width:320,height:180},pixels:{naturalWidth:320,naturalHeight:180}} as unknown as DecodedMedia;
 try{const {canvas,draws}=glFixture(),compositor=new WebGLCompositor(canvas);compositor.resize(320,180);const resources=new Map([[layer.clip.id,resource]]);
  assert.equal(compositor.draw([layer],resources,{width:320,height:180}).textureUploads,1);assert.equal(draws[0].opacity,1);
  assert.equal(compositor.draw([layer],resources,{width:320,height:180}).textureUploads,0);compositor.dispose();
 }finally{Object.assign(globalThis,{HTMLVideoElement:saved});}
});

test('neutral text applies the quantized authority alpha once while exact frames retain baked alpha',()=>{
 const saved=globalThis.HTMLVideoElement;Object.assign(globalThis,{HTMLVideoElement:class {}});
 const asset:Asset={id:'text-asset',kind:'text',path:'',duration:rational(20)},layer:PlannedVisual={clip:{...clip,id:'text-clip',materialId:asset.id},asset,sourceTime:rational(0),transform:{...defaultTransform(),opacity:.345},textRasterMode:'neutral'};
 const resource={id:'text-clip',state:'ready',asset:{...asset,width:320,height:180},pixels:{naturalWidth:320,naturalHeight:180}} as unknown as DecodedMedia;
 try{const {canvas,draws}=glFixture(),compositor=new WebGLCompositor(canvas);compositor.resize(320,180);const resources=new Map([[layer.clip.id,resource]]);
  assert.equal(compositor.draw([layer],resources,{width:320,height:180}).textureUploads,1);assert.equal(draws[0].opacity,1-Math.round((1-.345)*255)/255);
  compositor.draw([{...layer,textRasterMode:'frame'}],resources,{width:320,height:180});assert.equal(draws[1].opacity,1);compositor.dispose();
 }finally{Object.assign(globalThis,{HTMLVideoElement:saved});}
});

test('invalid public curve document reports fallback before constructing any curve clock',async()=>{
 const {canvas}=glFixture(),preview=new GpuPreview(canvas,{mediaUrl:a=>'http://127.0.0.1/media/'+a.id});
 try{const d=emptyDocument();d.assets.push({id:'v',kind:'video',path:'/unused.mp4',duration:rational(2),width:320,height:180});d.tracks[0].clips.push({...clip,materialId:'v',speedCurve:{points:[{x:.2,y:1},{x:.8,y:1}]}});
  const result=await preview.setDocument(d);assert.equal(result.state,'fallback');assert.equal(result.support.reasons[0].code,'INVALID_PREVIEW_DOCUMENT');assert.equal(result.decoders.length,0);
 }finally{preview.dispose();}
});


test('text frame providers are demand-only, strict about mode/revision, and replace exact-frame resources',async()=>{
 class ImageFake extends EventTarget {naturalWidth=320;naturalHeight=180;crossOrigin='';decoding='';value='';get src(){return this.value;}set src(value:string){this.value=value;if(value)queueMicrotask(()=>this.dispatchEvent(new Event('load')));}async decode(){}removeAttribute(){this.value='';}remove(){}}
 const saved={Image:globalThis.Image,HTMLVideoElement:globalThis.HTMLVideoElement,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 Object.assign(globalThis,{Image:ImageFake,HTMLVideoElement:class {},requestAnimationFrame:(fn:FrameRequestCallback)=>{queueMicrotask(()=>fn(0));return 1;},cancelAnimationFrame:()=>{}});
 try{const d=emptyDocument();d.canvas={width:320,height:180};d.assets=[{id:'txt',kind:'text',path:'',duration:rational(20)}];d.tracks[2].clips=[{...clip,id:'caption',materialId:'txt',transform:defaultTransform(),text:{content:'中文',font:'Source Han Sans SC Medium',size:24,color:'#ffffff'},animations:[{property:'x',points:[{id:'a',time:rational(0),value:-10,interpolation:'linear'},{id:'b',time:rational(2),value:10,interpolation:'linear'}]}]}];
  const calls:{mode?:string;frame?:number}[]=[],{canvas}=glFixture(),preview=new GpuPreview(canvas,{mediaUrl:()=>{throw Error('text must not resolve as normal media');},textTexture:async(clipId,context)=>{calls.push(context);return {clipId,revision:context.revision,mode:context.mode,frame:context.frame,width:320,height:180,url:'http://127.0.0.1/text-renders/'+String(context.frame===31?30:context.frame).padStart(64,'0')+'.png'};}});
  await preview.setDocument(d,{textContext:{projectId:'p',revision:4}});assert.equal(preview.manifest.state,'ready');assert.deepEqual(calls.map(c=>[c.mode,c.frame]),[['frame',0]]);assert.equal(preview.manifest.metrics.textureUploads,1);
  await preview.seek(1);assert.deepEqual(calls.map(c=>c.frame),[0,30]);assert.equal(preview.manifest.metrics.cachedMedia,1);assert.equal(preview.manifest.metrics.textureUploads,2);await preview.seek(1);assert.equal(calls.length,2);assert.equal(preview.manifest.frameRasters,1);assert.equal(preview.manifest.previewQuality,'exact-frames');await preview.seek(rational(31,30));await preview.seek(rational(31,30));assert.deepEqual(calls.map(c=>c.frame),[0,30,31],'repeated same-hash target frame must not re-request');assert.equal(preview.manifest.metrics.textureUploads,2,'same content should retain its existing GPU texture');preview.dispose();
  const fixture=glFixture(),bad=new GpuPreview(fixture.canvas,{mediaUrl:()=>'',textTexture:async(clipId,context)=>({clipId,revision:context.revision,mode:'neutral',width:320,height:180,url:'http://127.0.0.1/text-renders/'+'a'.repeat(64)+'.png'})});await bad.setDocument(d,{textContext:{projectId:'p',revision:4}});assert.equal(bad.manifest.state,'fallback');assert.equal(bad.manifest.error?.code,'GPU_TEXT_TEXTURE_MODE_INVALID');assert.equal(bad.manifest.metrics.cachedMedia,0);bad.dispose();
 }finally{Object.assign(globalThis,saved);}
});
