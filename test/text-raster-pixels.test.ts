import test from 'node:test';import assert from 'node:assert/strict';import {recoverTextRGBA} from '../packages/media/src/text-raster-pixels.ts';
function oracle(black:Buffer,white:Buffer){const pixels=Buffer.alloc(black.length);for(let i=0;i<black.length;i+=4){const alpha=255-Math.round(((white[i]-black[i])+(white[i+1]-black[i+1])+(white[i+2]-black[i+2]))/3);pixels[i+3]=Math.max(0,Math.min(255,alpha));if(alpha>0)for(let c=0;c<3;c++)pixels[i+c]=Math.max(0,Math.min(255,Math.round(black[i+c]*255/alpha)));}return pixels;}
test('sparse alpha fast path preserves exact RGB recovery for all alpha levels and unaligned views',()=>{
 let seed=1;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
 for(const offset of[0,1]){const b=Buffer.alloc(4*4096+offset).subarray(offset),w=Buffer.alloc(b.length+offset).subarray(offset);for(let i=0;i<b.length;i++) {b[i]=rand();w[i]=rand();}for(let i=0;i<256;i++){b.set([0,0,0,255],i*4);w.set([255-i,255-i,255-i,255],i*4);}const reuse=Buffer.alloc(b.length,111);assert.deepEqual(recoverTextRGBA(b,w,reuse),oracle(b,w));assert.deepEqual(recoverTextRGBA(b,w),oracle(b,w));}
 assert.throws(()=>recoverTextRGBA(Buffer.alloc(3),Buffer.alloc(3)),/TEXT_RASTER_PIXELS_INVALID/);
});
