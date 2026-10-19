import test from 'node:test';
import assert from 'node:assert/strict';
import {CurveSounds} from '../apps/editor/src/preview/curve-sound.ts';
import {createPreviewPlan} from '../apps/editor/src/preview/plan.ts';
import {emptyDocument} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
import type {CurveAudioDescriptor} from '../apps/editor/src/preview/curve-sound.ts';
const context={projectId:'p',revision:2},key='a'.repeat(64),signal=new AbortController().signal;
const layer={asset:{id:'a',kind:'audio' as const,path:'/registered.wav',duration:rational(2),hasAudio:true},clip:{id:'c',materialId:'a',source:{start:rational(0),duration:rational(1)},target:{start:rational(0),duration:rational(1)},speed:rational(1),editableTiming:true,speedCurve:{points:[{x:0,y:1},{x:1,y:1}]}}};
function wav(){const n=44100,buffer=new ArrayBuffer(44+n*8),v=new DataView(buffer),u=new Uint8Array(buffer);function text(o:number,s:string){for(let i=0;i<s.length;i++)u[o+i]=s.charCodeAt(i);}text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,2,true);v.setUint32(24,44100,true);v.setUint32(28,44100*8,true);v.setUint16(32,8,true);v.setUint16(34,32,true);text(36,'data');v.setUint32(40,n*8,true);for(let i=0;i<n;i++){v.setFloat32(44+i*8,.25,true);v.setFloat32(48+i*8,-.125,true);}return buffer;}
const descriptor:CurveAudioDescriptor={key,url:'http://127.0.0.1:8834/curve-audio/'+key+'.wav',clipId:'c',revision:2,duration:1,sampleRate:44100,sampleCount:44100};
test('PCM fetch cache is demand-only, exact identity-bound and invalidated without creating AudioContext',async()=>{
 const previous=globalThis.fetch;let fetched=0,provided=0;globalThis.fetch=async()=>{fetched++;return new Response(wav(),{headers:{'content-type':'audio/wav'}});};
 try{const cache=new CurveSounds(async()=>{provided++;return descriptor;});assert.equal(cache.size,0);const pcm=await cache.prepare(layer,context,signal);assert.equal(pcm.channels[0][0],.25);assert.equal(pcm.channels[1][0],-.125);assert.equal(cache.bytes,44100*8);assert.equal(await cache.prepare(layer,context,signal),pcm);assert.equal(fetched,1);assert.equal(provided,1);cache.clear();assert.equal(cache.size,0);assert.equal(cache.bytes,0);await cache.prepare(layer,context,signal);assert.equal(fetched,2);}
 finally{globalThis.fetch=previous;}
});
test('PCM rejects stale metadata/remote URLs/oversize body and late cancellation instead of caching',async()=>{
 const previous=globalThis.fetch;let fetched=0;globalThis.fetch=async()=>{fetched++;return new Response(wav());};
 try{
 for(const change of [{revision:1},{clipId:'different'},{key:'invalid'},{sampleCount:44000},{sampleRate:48000},{duration:2},{url:'https://example.com/curve-audio/'+key+'.wav'},{url:descriptor.url+'?leak=1'}]){const cache=new CurveSounds(async()=>({...descriptor,...change}));await assert.rejects(cache.prepare(layer,context,signal),/GPU_CURVE_AUDIO_(DESCRIPTOR|URL)_INVALID/);assert.equal(cache.bytes,0);}assert.equal(fetched,0);
 const a=new AbortController(),cache=new CurveSounds(async()=>{a.abort();return descriptor;});await assert.rejects(cache.prepare(layer,context,a.signal),{name:'AbortError'});assert.equal(fetched,0);
 let resolve!:(v:CurveAudioDescriptor)=>void,start!:()=>void;const entered=new Promise<void>(r=>{start=r;});const stale=new CurveSounds(()=>new Promise(r=>{resolve=r;start();})),pending=stale.prepare(layer,context,signal);await entered;stale.clear();resolve(descriptor);await assert.rejects(pending,{name:'AbortError'});assert.equal(stale.size,0);
 globalThis.fetch=async()=>new Response(new Uint8Array(1),{headers:{'content-length':String(34*1024*1024)}});await assert.rejects(new CurveSounds(async()=>descriptor).prepare(layer,context,signal),/GPU_CURVE_AUDIO_SIZE_LIMIT/);
 }finally{globalThis.fetch=previous;}
});
test('audible curve plan opens only with the sidecar service and bounded target PCM, retaining source volume automation',()=>{
 const doc=emptyDocument();doc.assets=[layer.asset];doc.tracks=[{id:'a',kind:'audio',clips:[structuredClone(layer.clip)]}];
 assert(createPreviewPlan(doc).support.reasons.some(r=>r.code==='CURVE_AUDIO_REQUIRES_OFFLINE_RENDER'));
 assert(createPreviewPlan(doc,{curveAudioAvailable:true}).support.supported);
 const clip=doc.tracks[0].clips[0];clip.volume=0;clip.animations=[{property:'volume',points:[{id:'p0',time:rational(0),value:0,interpolation:'linear'},{id:'p1',time:rational(1),value:1,interpolation:'linear'}]}];assert.equal(createPreviewPlan(doc,{curveAudioAvailable:true}).plan!.audio.length,1);
 clip.source.duration=rational(100);clip.target.duration=rational(100);doc.assets[0].duration=rational(100);assert(createPreviewPlan(doc,{curveAudioAvailable:true}).support.reasons.some(r=>r.code==='GPU_CURVE_AUDIO_SIZE_LIMIT'));
});
