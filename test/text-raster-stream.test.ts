import test from 'node:test';import assert from 'node:assert/strict';import {Writable} from 'node:stream';
import {recoverTextFrameStream} from '../packages/media/src/text-raster-stream.ts';
const black=Buffer.from([0,0,0,255,20,40,60,255]),white=Buffer.from([255,255,255,255,147,167,187,255]);
async function* chunks(bytes:Buffer){for(let i=0;i<bytes.length;i+=3)yield bytes.subarray(i,i+3);}
test('exact paired-frame stream handles split pixels/frames and writable backpressure with bounded buffers',async()=>{
 const out:Buffer[]=[];const sink=new Writable({highWaterMark:1,write(chunk,_encoding,done){out.push(Buffer.from(chunk));setTimeout(done,1);}});
 const input=Buffer.concat([black,white,black,white]);await recoverTextFrameStream(chunks(input),sink,8,2);sink.end();
 assert.deepEqual(Buffer.concat(out),Buffer.from([0,0,0,0,40,80,120,128,0,0,0,0,40,80,120,128]));
});
test('exact stream rejects short and extra frames and propagates sink failures',async()=>{
 for(const bytes of[Buffer.concat([black,white]).subarray(0,15),Buffer.concat([black,white,black])]){
  const sink=new Writable({write(_c,_e,done){done();}});await assert.rejects(recoverTextFrameStream(chunks(bytes),sink,8,1),/TEXT_RASTER_PIXELS_INVALID/);sink.destroy();
 }
 const sink=new Writable({highWaterMark:1,write(_c,_e,done){done(Error('sink failed'));}});await assert.rejects(recoverTextFrameStream(chunks(Buffer.concat([black,white])),sink,8,1),/sink failed/);
});
test('cancelled fragmented stream stops without writing a later frame',async()=>{
 const controller=new AbortController();const out:Buffer[]=[];const sink=new Writable({write(chunk,_e,done){out.push(Buffer.from(chunk));done();}});
 async function* input(){yield black;controller.abort();yield white;}
 await assert.rejects(recoverTextFrameStream(input(),sink,8,1,controller.signal),/JOB_CANCELLED/);assert.equal(out.length,0);sink.destroy();
});
test('a blocked encoder does not pull an entire32-frame window into JavaScript',async()=>{
 let produced=0,release:(()=>void)|undefined;async function* input(){for(let i=0;i<32;i++){produced++;yield Buffer.concat([black,white]);}}
 const sink=new Writable({highWaterMark:1,write(_chunk,_encoding,done){if(!release)release=()=>done();else done();}}),work=recoverTextFrameStream(input(),sink,8,32);void work.catch(()=>{});
 for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));assert(produced<=3,`at most current pair plus bounded prefetch, got ${produced}`);assert(release);release();await work;
});

test('raw stream validates frame and window budgets before allocation',async()=>{for(const [bytes,frames]of[[1920*1080*4+4,1],[1920*1080*4,17],[4,33],[3,1]]){const sink=new Writable({write(_c,_e,done){done();}});await assert.rejects(recoverTextFrameStream(chunks(Buffer.alloc(0)),sink,bytes,frames),/TEXT_RASTER_PIXELS_INVALID/);sink.destroy();}});
