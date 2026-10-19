import test from 'node:test';import assert from 'node:assert/strict';
import type {DecodeState} from '../apps/editor/src/preview/decode.ts';
import {TextFrameCache} from '../apps/editor/src/preview/text-cache.ts';
import type {TextContext,TextTexture,TextFrameRequest} from '../apps/editor/src/preview/text-cache.ts';
const texture=(frame:number,url=1):TextTexture=>({clipId:'t',revision:1,mode:'frame',frame,width:4,height:4,url:`http://127.0.0.1/text-renders/${url.toString(16).padStart(64,'0')}.png`});
const request=(frame:number,clipId='t'):TextFrameRequest=>({clipId,asset:{id:'a',kind:'text',path:'/text',duration:{numerator:'3',denominator:'1'}},mode:'frame',frame});
class FakeResource{state:DecodeState='ready';ready=Promise.resolve();disposed=false;url:string;constructor(url:string){this.url=url;}dispose(){this.disposed=true;this.state='disposed';}}
function cache(provider:(_id:string,ctx:TextContext,signal:AbortSignal)=>Promise<TextTexture>,limits={textures:32,bytes:128*1024*1024,aliasesPerClip:300}){const made:FakeResource[]=[];const c=new TextFrameCache(provider,(_r,t)=>{const r=new FakeResource(t.url);made.push(r);return r;},limits);c.reset({projectId:'p',revision:1},4,4);return {c,made};}
test('different frame aliases share one decoded PNG; ready hits make no provider/decode request',async()=>{
 const {c,made}=cache(async(_id,ctx)=>texture(ctx.frame!));await c.warm([request(0),request(1),request(2)]);assert.equal(c.metrics.requests,3);assert.equal(c.metrics.textures,1);assert.equal(c.metrics.aliases,3);assert.equal(made.length,1);
 const a=c.get(request(1));assert.equal(await c.prepare(request(2)),a);assert.equal(c.metrics.requests,3);c.dispose();assert.equal(made[0].disposed,true);
});
test('warm stops at unique-image budget and preserves opening frames; foreground evicts only unpinned images',async()=>{
 const {c,made}=cache(async(_id,ctx)=>texture(ctx.frame!,ctx.frame!+1),{textures:2,bytes:128,aliasesPerClip:300});await c.warm([request(0),request(1),request(2),request(3)]);
 assert.equal(c.metrics.requests,3);await c.warm([request(0),request(1),request(2)]);assert.equal(c.metrics.requests,3,'full warm boundary must not issue repeated HTTP');assert.equal(c.metrics.budgetStops,1);assert.equal(c.metrics.bytes,128);assert.ok(c.get(request(0)));assert.equal(c.get(request(2)),undefined);
 const first=c.get(request(0))!;await c.prepare(request(2),undefined,new Set([first.url]));assert.equal(first.disposed,false);assert.equal(made[1].disposed,true);assert.equal(c.metrics.textures,2);assert.ok(c.get(request(2)));c.dispose();
});
test('byte budget is enforced independently and oversized warm creates no decoded resource',async()=>{
 const {c,made}=cache(async(_id,ctx)=>texture(ctx.frame!),{textures:32,bytes:63,aliasesPerClip:300});await c.warm([request(0),request(1)]);assert.equal(made.length,0);assert.equal(c.metrics.budgetStops,1);await assert.rejects(c.prepare(request(0)),/GPU_TEXT_CACHE_BUDGET/);c.dispose();
});
test('aliases are bounded per clip even for identical PNGs',async()=>{
 const {c}=cache(async(_id,ctx)=>texture(ctx.frame!),{textures:32,bytes:128,aliasesPerClip:2});await c.warm([request(0),request(1),request(2)]);assert.equal(c.metrics.aliases,2);assert.equal(c.metrics.requests,2);await assert.rejects(c.prepare(request(2)),/GPU_TEXT_CACHE_ALIAS_LIMIT/);c.dispose();
});
test('strict mode/frame/revision/clip/dimensions are checked before decoding',async()=>{
 for(const patch of[{clipId:'wrong'},{revision:2},{frame:1},{mode:'neutral' as const},{width:5},{url:'https://example.com/text-renders/'+ '1'.repeat(64)+'.png'}]){
  const {c,made}=cache(async()=>({...texture(0),...patch}));await assert.rejects(c.prepare(request(0)),/GPU_TEXT_TEXTURE_|GPU_REGISTERED_MEDIA_URL_REQUIRED/);assert.equal(made.length,0);c.dispose();
 }
});
test('reset isolates identical clip/frame across projects and ignores a provider that resolves after abort',async()=>{
 let resolve!:(t:TextTexture)=>void,signal!:AbortSignal;const {c,made}=cache(async(_id,_ctx,s)=>{signal=s;return new Promise(r=>{resolve=r;});});const old=c.prepare(request(0));await Promise.resolve();c.reset({projectId:'other',revision:1},4,4);assert.equal(signal.aborted,true);resolve(texture(0));await assert.rejects(old,{name:'AbortError'});assert.equal(made.length,0);assert.equal(c.metrics.textures,0);c.dispose();
});
test('dispose during deferred image decode releases image and cannot publish an alias',async()=>{
 let finish!:()=>void;let resource!:FakeResource;const c=new TextFrameCache(async()=>texture(0),(_r,t)=>{resource=new FakeResource(t.url);resource.state='loading';resource.ready=new Promise(r=>{finish=r;});return resource;});c.reset({projectId:'p',revision:1},4,4);
 const pending=c.prepare(request(0));await new Promise<void>(r=>setImmediate(r));c.dispose();assert.equal(resource.disposed,true);finish();await assert.rejects(pending,{name:'AbortError'});assert.equal(c.metrics.aliases,0);assert.equal(c.metrics.textures,0);
});
test('same frame concurrent requests share provider promise; caller cancellation cannot abort another consumer',async()=>{
 let finish!:(t:TextTexture)=>void;const {c}=cache(async()=>new Promise(r=>{finish=r;}));const abort=new AbortController(),a=c.prepare(request(0),abort.signal),b=c.prepare(request(0));abort.abort();await assert.rejects(a,{name:'AbortError'});finish(texture(0));assert.ok(await b);assert.equal(c.metrics.requests,1);c.dispose();
});

test('already aborted foreground requests never start a provider and static textures also require identity',async()=>{
 let calls=0;const {c}=cache(async()=>{calls++;return texture(0);});const controller=new AbortController();controller.abort();await assert.rejects(c.prepare(request(0),controller.signal),{name:'AbortError'});assert.equal(calls,0);c.dispose();
 const other=cache(async()=>({url:texture(0).url,width:4,height:4}));await assert.rejects(other.c.prepare({...request(0),mode:undefined,frame:undefined}),/GPU_TEXT_TEXTURE_IDENTITY_INVALID/);other.c.dispose();
});

test('foreground joins a full-budget warm pending and then retries with safe foreground eviction',async()=>{
 let finish!:(texture:TextTexture)=>void;const calls:number[]=[];const {c,made}=cache(async(_id,ctx)=>{calls.push(ctx.frame!);if(ctx.frame===1&&calls.filter(f=>f===1).length===1)return new Promise(resolve=>{finish=resolve;});return texture(ctx.frame!,ctx.frame!+1);},{textures:1,bytes:64,aliasesPerClip:300});
 await c.prepare(request(0));const warming=c.warm([request(1)]),foreground=c.prepare(request(1));finish(texture(1,2));await warming;const ready=await foreground;assert.equal(ready.url,texture(1,2).url);assert.equal(made[0].disposed,true);assert.equal(c.metrics.textures,1);assert.equal(c.get(request(1)),ready);assert.deepEqual(calls,[0,1,1]);c.dispose();
});

test('synchronous provider cancellation also observes a later underlying provider rejection',async()=>{
 const controller=new AbortController(),unhandled:unknown[]=[];let fail!:(error:Error)=>void;const listener=(error:unknown)=>unhandled.push(error);process.on('unhandledRejection',listener);
 const {c}=cache(async()=>{controller.abort();return new Promise((_resolve,reject)=>{fail=reject;});});
 try{await assert.rejects(c.prepare(request(0),controller.signal),{name:'AbortError'});fail(Error('LATE_PROVIDER_FAILURE'));await new Promise<void>(r=>setImmediate(()=>setImmediate(r)));assert.deepEqual(unhandled,[]);}finally{c.dispose();process.removeListener('unhandledRejection',listener);}
});
test('rolling spans 64 unique frames with bounded images while preserving current and the future horizon',async()=>{
 const {c,made}=cache(async(_id,ctx)=>texture(ctx.frame!,ctx.frame!+1),{textures:4,bytes:256,aliasesPerClip:300});await c.prepare(request(0));let current=c.get(request(0))!;const pins=()=>new Set([current.url]);
 for(let frame=0;frame<64;frame++){
  const horizon=Array.from({length:Math.min(4,64-frame)},(_,i)=>request(frame+i));await c.roll(horizon,pins);const at=c.get(request(frame));assert.ok(at,'requested current frame must be ready');current=at;
  assert.equal(current.disposed,false);assert(c.metrics.textures<=4);assert(c.metrics.bytes<=256);assert(c.metrics.aliases<=4);
 }
 assert(c.metrics.evictions>=60);assert(made.length>=64);assert.equal(current.url,texture(63,64).url);c.dispose();assert(made.every(r=>r.disposed));
});
test('rolling replaces a queued seek horizon without loading the old remaining frames',async()=>{
 let resolve!:(texture:TextTexture)=>void;const frames:number[]=[];const {c}=cache(async(_id,ctx)=>{frames.push(ctx.frame!);if(ctx.frame===1)return new Promise(r=>{resolve=r;});return texture(ctx.frame!,ctx.frame!+1);},{textures:4,bytes:256,aliasesPerClip:300});
 await c.prepare(request(0));const first=c.roll([request(0),request(1),request(2),request(3)],()=>new Set());await Promise.resolve();const second=c.roll([request(50),request(51),request(52),request(53)],()=>new Set());resolve(texture(1,2));await Promise.all([first,second]);
 assert.equal(frames.includes(2),false);assert.equal(frames.includes(3),false);assert.ok(c.get(request(50)));assert.ok(c.get(request(53)));assert(c.metrics.textures<=4);assert(c.metrics.supersededWindows>0);c.dispose();
});
test('rolling cannot evict a current pin even when every other image belongs to the future window',async()=>{
 const {c}=cache(async(_id,ctx)=>texture(ctx.frame!,ctx.frame!+1),{textures:2,bytes:128,aliasesPerClip:300});const current=await c.prepare(request(0));await c.prepare(request(1));await c.roll([request(1),request(2)],()=>new Set([current.url]));assert.equal(current.disposed,false);assert.ok(c.get(request(1)));assert.equal(c.get(request(2)),undefined);assert.equal(c.metrics.textures,2);c.dispose();
});
test('rolling reset/dispose rejects an ignored-abort provider and never revives decoded resources',async()=>{
 let resolve!:(texture:TextTexture)=>void,start!:()=>void;const started=new Promise<void>(r=>{start=r;});const {c,made}=cache(async()=>new Promise(r=>{resolve=r;start();}));const pending=c.roll([request(0)],()=>new Set());await started;c.reset({projectId:'new',revision:1},4,4);resolve(texture(0));await assert.rejects(pending,{name:'AbortError'});assert.equal(made.length,0);assert.equal(c.metrics.textures,0);assert.equal(c.metrics.rollingRequests,0);c.dispose();
});

test('a late foreground load reads current pins when evicting rather than its earlier seek snapshot',async()=>{
 let finish!:(texture:TextTexture)=>void;const {c,made}=cache(async(_id,ctx)=>ctx.frame===1?new Promise(r=>{finish=r;}):texture(ctx.frame!,ctx.frame!+1),{textures:2,bytes:128,aliasesPerClip:300});let current=await c.prepare(request(0));const late=c.prepare(request(1),undefined,()=>new Set([current.url]));current=await c.prepare(request(2));finish(texture(1,2));await late;assert.equal(current.disposed,false);assert.equal(c.get(request(2)),current);assert.equal(made[0].disposed,true);assert.equal(c.metrics.textures,2);c.dispose();
});
test('a new rolling window queued during producer completion is still consumed',async()=>{
 const calls:number[]=[];const {c}=cache(async(_id,ctx)=>{calls.push(ctx.frame!);return texture(ctx.frame!,ctx.frame!+1);});const first=c.roll([request(0)],()=>new Set());for(let i=0;i<4;i++)await Promise.resolve();const second=c.roll([request(1)],()=>new Set());await Promise.all([first,second]);assert.deepEqual(calls,[0,1]);assert.ok(c.get(request(1)));c.dispose();
});
