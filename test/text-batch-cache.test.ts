import test from 'node:test';import assert from 'node:assert/strict';
import {TextFrameCache} from '../apps/editor/src/preview/text-cache.ts';
import type {TextBatchProvider,TextFrameRequest,TextTexture} from '../apps/editor/src/preview/text-cache.ts';
const request=(frame:number,clipId='t'):TextFrameRequest=>({clipId,asset:{id:'a',kind:'text',path:'/text',duration:{numerator:'3',denominator:'1'}},mode:'frame',frame});
const texture=(frame:number,clipId='t'):TextTexture=>({clipId,revision:1,mode:'frame',frame,width:4,height:4,url:`http://127.0.0.1/text-renders/${(frame+1).toString(16).padStart(64,'0')}.png`});
function fixture(batch:TextBatchProvider){let scalar=0;const resources:{disposed:boolean}[]=[];const c=new TextFrameCache(async(id,ctx)=>{scalar++;return texture(ctx.frame!,id);},(_r,t)=>{const r={url:t.url,state:'ready' as const,ready:Promise.resolve(),disposed:false,dispose(){this.disposed=true;}};resources.push(r);return r;},{textures:4,bytes:256,aliasesPerClip:300},batch);c.reset({projectId:'p',revision:1},4,4);return {c,resources,scalar:()=>scalar};}
test('warm and rolling batch exact descriptors, retain active pins, and bound decoded RGBA',async()=>{
 const calls:number[][]=[];const {c,scalar}=fixture(async(id,ctx,frames)=>{assert.equal(ctx.projectId,'p');calls.push([...frames]);return frames.map(f=>texture(f,id));});
 await c.warm([0,1,2,3].map(f=>request(f)));assert.deepEqual(calls,[[0,1,2,3]]);assert.equal(scalar(),0);const current=c.get(request(3))!;
 await c.roll([3,4,5,6].map(f=>request(f)),()=>new Set([current.url]));assert.deepEqual(calls,[[0,1,2,3],[4,5,6]]);assert.equal(c.metrics.textures,4);assert.equal(c.metrics.bytes,256);assert.equal(c.metrics.batchFrames,7);assert.equal(c.metrics.evictions,3);assert.equal(current.disposed,false);assert.ok(c.get(request(6)));c.dispose();
});
test('foreground joins a pending batch rather than making a scalar request',async()=>{
 let finish!:(textures:TextTexture[])=>void;const {c,scalar}=fixture(async()=>new Promise(r=>{finish=r;}));const warming=c.warm([request(0),request(1)]),foreground=c.prepare(request(1));finish([texture(0),texture(1)]);await warming;assert.equal((await foreground).url,texture(1).url);assert.equal(scalar(),0);assert.equal(c.metrics.decodes,2);c.dispose();
});
test('batch response length, frame order, clip, revision and canvas reject before decoding',async()=>{
 for(const mutate of[(a:TextTexture[])=>a.slice(1),(a:TextTexture[])=>a.reverse(),(a:TextTexture[])=>a.map(t=>({...t,clipId:'other'})),(a:TextTexture[])=>a.map(t=>({...t,revision:2})),(a:TextTexture[])=>a.map(t=>({...t,width:5}))]){
  const {c,resources}=fixture(async()=>mutate([texture(0),texture(1)]));await assert.rejects(c.warm([request(0),request(1)]),/GPU_TEXT_BATCH_RESPONSE_INVALID|GPU_TEXT_TEXTURE_/);assert.equal(resources.length,0);assert.equal(c.metrics.pendingBatches,0);c.dispose();
 }
});
test('reset aborts an ignored batch, observes late rejection, and clears pending descriptor ownership',async()=>{
 let fail!:(e:Error)=>void,signal!:AbortSignal;const unhandled:unknown[]=[];const listener=(e:unknown)=>unhandled.push(e);process.on('unhandledRejection',listener);const {c,resources}=fixture(async(_id,_ctx,_frames,s)=>{signal=s;return new Promise((_r,reject)=>{fail=reject;});});
 try{const work=c.roll([request(0),request(1)],()=>new Set());c.reset({projectId:'new',revision:2},4,4);assert.equal(signal.aborted,true);fail(Error('LATE_BATCH_FAILURE'));await assert.rejects(work);await new Promise<void>(r=>setImmediate(()=>setImmediate(r)));assert.equal(resources.length,0);assert.equal(c.metrics.pendingBatches,0);assert.equal(c.metrics.rollingRequests,0);assert.deepEqual(unhandled,[]);}finally{c.dispose();process.removeListener('unhandledRejection',listener);}
});
test('stale completed batch decodes only frames retained by the latest seek horizon',async()=>{
 let finish!:(textures:TextTexture[])=>void;const calls:number[][]=[];const {c,scalar}=fixture(async(_id,_ctx,frames)=>{calls.push([...frames]);if(frames[0]===0)return new Promise(r=>{finish=r;});return frames.map(f=>texture(f));});
 const old=c.roll([0,1,2,3].map(f=>request(f)),()=>new Set()),latest=c.roll([50,51,52,53].map(f=>request(f)),()=>new Set());finish([0,1,2,3].map(f=>texture(f)));await Promise.all([old,latest]);assert.equal(c.get(request(0)),undefined);assert.ok(c.get(request(53)));assert.equal(c.metrics.decodes,4);assert.equal(scalar(),0);assert.deepEqual(calls,[[0,1,2,3],[50,51,52,53]]);c.dispose();
});
