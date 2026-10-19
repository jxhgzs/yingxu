import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational as r,div,mul,sub} from '../packages/core/src/time.ts';
import type {Rational} from '../packages/core/src/time.ts';
import {render} from '../packages/media/src/render.ts';
import {renderGraph} from '../packages/media/src/graph.ts';
import {rasterText} from '../packages/media/src/text-raster.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
import {runProcess} from '../packages/media/src/process.ts';

const rates=[r(30),r(60),r(30000,1001),r(99)];
function fixture(fps:Rational,count:number){
 const d=emptyDocument(),duration=div(r(count),fps);d.canvas={width:160,height:90};d.fps=fps;d.assets=[{id:'text',kind:'text',path:'',duration}];
 d.tracks=[{id:'t',kind:'text',clips:[{id:'c',materialId:'text',source:{start:r(0),duration},target:{start:r(0),duration},speed:r(1),editableTiming:true,transform:defaultTransform(),text:{content:'M',font:'Source Han Sans SC Medium',size:48,color:'#ffffff',outline:0,shadow:0}}]}];return d;
}
async function gray(file:string,root:string,name:string){const out=path.join(root,name);await runProcess(ffmpeg(),['-v','error','-y','-i',file,'-an','-pix_fmt','gray','-f','rawvideo',out],{timeout:30000});return fs.readFile(out);}
function assertFrames(frames:Buffer,count:number,visible:(frame:number)=>boolean){
 const size=160*90;assert.equal(frames.length,count*size);const indices:number[]=[];for(let p=0;p<size;p++)if(frames[p]>230)indices.push(p);assert(indices.length>100);
 for(let n=0;n<count;n++){
  const mean=indices.reduce((sum,p)=>sum+frames[n*size+p],0)/indices.length;
  if(visible(n))assert(mean>230,`expected visible frame ${n}, got mean ${mean}`);else assert(mean<4,`expected empty frame ${n}, got mean ${mean}`);
 }
}

test('libass event selection keeps every source-clock property frame at 30/60/NTSC including frame111/222',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'subtitle-clock-'));
 try{for(const fps of rates){
  const count=fps.numerator==='60'?240:fps.numerator==='99'?396:120,d=fixture(fps,count),clip=d.tracks[0].clips[0];
  clip.animations=[{property:'opacity',points:Array.from({length:count},(_,frame)=>({id:String(frame),time:div(r(frame),fps),value:frame%2===0?1:0,interpolation:'hold' as const}))}];
  const dir=path.join(root,fps.numerator),result=await render(d,dir),frames=await gray(result.path,dir,'frames.gray');assertFrames(frames,count,n=>n%2===0);
  // Exact PNG requests use the same libass event clock; check both sides of
  // the formerly wrong 3.7-second boundary as well as the first/last frames.
  const sensitive=fps.numerator==='60'?222:111,layer=renderGraph(d).layers[0];
  for(const frame of [0,1,sensitive-1,sensitive,count-1]){
   const cache=path.join(dir,'raster-'+frame),image=await rasterText(layer,d.canvas,cache,{mode:'frame',frame,fps}),out=path.join(cache,'decoded.rgba');
   await runProcess(ffmpeg(),['-v','error','-y','-i',image.path,'-pix_fmt','rgba','-f','rawvideo',out]);const pixels=await fs.readFile(out);
   const alpha:number[]=[];for(let p=3;p<pixels.length;p+=4)alpha.push(pixels[p]);
   if(frame%2===0)assert(alpha.filter(a=>a>230).length>100,`missing exact raster ${fps.numerator}/${fps.denominator} frame ${frame}`);else assert.equal(Math.max(...alpha),0,`stale exact raster ${fps.numerator}/${fps.denominator} frame ${frame}`);
  }
 }}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('libass sampling restores frame PTS and preserves first/last single-frame subtitle intervals',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'subtitle-edge-'));
 try{for(const fps of rates){
  const count=fps.numerator==='60'?240:fps.numerator==='99'?396:120,d=fixture(fps,count),first=d.tracks[0].clips[0],duration=div(r(1),fps);
  first.source.duration=duration;first.target.duration=duration;
  d.tracks[0].clips.push({...structuredClone(first),id:'last',target:{start:div(r(count-1),fps),duration}});
  const dir=path.join(root,fps.numerator),result=await render(d,dir),frames=await gray(result.path,dir,'edges.gray');assertFrames(frames,count,n=>n===0||n===count-1);
  assert.deepEqual(mul(sub(d.tracks[0].clips[1].target.start,first.target.start),fps),r(count-1));
 }}finally{await fs.rm(root,{recursive:true,force:true});}
});
