import test from 'node:test';
import assert from 'node:assert/strict';
import {blackWhiteParameters,applyBlackWhiteChannel,FADE_NODES,fadeCurve,applyFadeChannel} from '../packages/core/src/color-tones.ts';
const close=(a:number,b:number)=>assert(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('black/white candidate maps distinct control points to a clamped affine curve',()=>{
 assert.deepEqual(blackWhiteParameters(0,0),{slope:1,offset:0});
 close(applyBlackWhiteChannel(.5,.5,0),.625);close(applyBlackWhiteChannel(.5,-.5,0),1/3);
 close(applyBlackWhiteChannel(.5,0,.5),2/3);close(applyBlackWhiteChannel(.5,0,-.5),.375);
 close(applyBlackWhiteChannel(.5,.5,-.5),.5);close(applyBlackWhiteChannel(.5,-.5,.5),.5);
 const steep=blackWhiteParameters(-1,1);close(steep.slope,200);close(steep.offset,-99);
 close(applyBlackWhiteChannel(.495,-1,1),0);close(applyBlackWhiteChannel(.4975,-1,1),.5);close(applyBlackWhiteChannel(.5,-1,1),1);
 for(let b=-10;b<=10;b++)for(let w=-10;w<=10;w++){
  let previous=-1;for(let c=0;c<=32;c++){
   const result=applyBlackWhiteChannel(c/32,b/10,w/10);assert(Number.isFinite(result)&&result>=previous&&result>=0&&result<=1);previous=result;
  }
 }
});

test('fade candidate interpolates all seventeen measured nodes and mixes once with input',()=>{
 assert.equal(FADE_NODES.length,17);
 for(let n=0;n<=16;n++){
  close(fadeCurve(n/16),FADE_NODES[n]/255);close(applyFadeChannel(n/16,1),FADE_NODES[n]/255);close(applyFadeChannel(n/16,0),n/16);
  close(applyFadeChannel(n/16,.5),(n/16+FADE_NODES[n]/255)/2);
  if(n<16)close(fadeCurve((n+.5)/16),(FADE_NODES[n]+FADE_NODES[n+1])/510);
 }
 for(let c=0;c<256;c++)assert(fadeCurve((c+1)/256)>=fadeCurve(c/256));
});

test('tone candidates reject nonfinite inputs, unknown ranges and negative merged fade',()=>{
 for(const n of [-1.01,1.01,NaN,Infinity,-Infinity]){
  assert.throws(()=>blackWhiteParameters(n,0),/INTENSITY/);assert.throws(()=>blackWhiteParameters(0,n),/INTENSITY/);
 }
 for(const n of [-.1,1.01,NaN,Infinity]){
  assert.throws(()=>fadeCurve(n),/CHANNEL/);assert.throws(()=>applyBlackWhiteChannel(n,0,0),/CHANNEL/);
 }
 for(const n of [-.1,1.01,NaN,Infinity])assert.throws(()=>applyFadeChannel(.5,n),/INTENSITY/);
});
