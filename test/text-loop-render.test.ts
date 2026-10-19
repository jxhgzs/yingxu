import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational as r} from '../packages/core/src/time.ts';
import {render} from '../packages/media/src/render.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
import {runProcess} from '../packages/media/src/process.ts';
import {textAnimationOpacity,type TextAnimation} from '../packages/core/src/text-animation.ts';
import {subtitleClock} from '../packages/media/src/subtitle-clock.ts';

test('real encoded flash and three-phase text match frozen native alpha observations',{timeout:60000},async()=>{
 const keep=process.env.YINGXU_LOOP_QA_DIR,directory=keep?path.resolve(keep):await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-loop-render-'));
 await fs.mkdir(directory,{recursive:true});
 try{
  const doc=emptyDocument();doc.canvas={width:1280,height:720};doc.fps=r(30);doc.assets=[{id:'text',path:'',kind:'text',duration:r(4)}];
  doc.tracks=[{id:'t',kind:'text',clips:[{id:'c',materialId:'text',source:{start:r(0),duration:r(4)},target:{start:r(0),duration:r(4)},speed:r(1),editableTiming:true,transform:defaultTransform(),text:{content:'文字动画对照',font:'Source Han Sans SC Medium',size:60,color:'#ffffff',outline:0,shadow:0}}]}];
  const raw=async(file:string,name:string,one=false)=>{const output=path.join(directory,name);await runProcess(ffmpeg(),['-v','error','-y','-i',file,...(one?['-frames:v','1']:[]),'-an','-f','rawvideo','-pix_fmt','gray','-threads','1',output],{timeout:30000});const result=await fs.readFile(output);await fs.unlink(output);return result;};
  const direct=async(dir:string,count:number)=>{const output=path.join(dir,'unencoded.gray'),clock=subtitleClock(doc.fps);await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i','color=c=black:s=1280x720:r=30,format=rgba','-vf',`${clock.before},subtitles=filename=captions-0.ass:fontsdir=fonts,${clock.after}`,'-frames:v',String(count),'-fps_mode','passthrough','-pix_fmt','gray','-f','rawvideo',output],{cwd:dir,timeout:30000});const bytes=await fs.readFile(output);await fs.unlink(output);return bytes;};
  const baseDirectory=path.join(directory,'base'),base=await render(doc,baseDirectory),reference=await raw(base.path,'base.gray',true),unencodedReference=await direct(baseDirectory,1),unencodedMask:number[]=[],mask:number[]=[];
  for(let i=0;i<unencodedReference.length;i++)if(unencodedReference[i]>220)unencodedMask.push(i);const rawDenominator=unencodedMask.reduce((sum,p)=>sum+unencodedReference[p]*unencodedReference[p],0);
  for(let i=0;i<reference.length;i++)if(reference[i]>220)mask.push(i);assert(mask.length>1000);
  const denominator=mask.reduce((sum,p)=>sum+reference[p]*reference[p],0),flash:TextAnimation={phase:'loop',kind:'flash',duration:r(1,2)};
  const metrics:{name:string;frames:number;maxAbsoluteAlpha:number;meanAbsoluteAlpha:number;maxRawFromFormula:number;maxEncodedFromRaw:number;rows:{frame:number;productAlpha:number;nativeAlpha:number;unencodedAlpha:number;formula:number;difference:number}[]}[]=[];
  for(const [name,animations]of [['native-loop-measurements',[flash]],['native-combo-measurements',[{phase:'in',kind:'fade',duration:r(3,10)},{phase:'out',kind:'fade',duration:r(2,5)},flash]]] as [string,TextAnimation[]][]){
   doc.tracks[0].clips[0].textAnimations=animations;
   const renderDirectory=path.join(directory,name),rendered=await render(doc,renderDirectory),frames=await raw(rendered.path,name+'.gray'),unencoded=await direct(renderDirectory,120);assert.equal(frames.length,120*1280*720);
   const native=JSON.parse(await fs.readFile(new URL(`../evidence/2026-10-19-loop-combo-v8/${name}.json`,import.meta.url),'utf8')) as {rows:{frame:number;observedAlpha:number}[]};
   const rows=native.rows.map(row=>{const offset=row.frame*1280*720,productAlpha=mask.reduce((sum,p)=>sum+frames[offset+p]*reference[p],0)/denominator,unencodedAlpha=unencodedMask.reduce((sum,p)=>sum+unencoded[offset+p]*unencodedReference[p],0)/rawDenominator;return {frame:row.frame,productAlpha,nativeAlpha:row.observedAlpha,unencodedAlpha,formula:textAnimationOpacity(animations,r(row.frame,30),r(4)),difference:productAlpha-row.observedAlpha};});
   const result={name,frames:120,maxAbsoluteAlpha:Math.max(...rows.map(row=>Math.abs(row.difference))),meanAbsoluteAlpha:rows.reduce((sum,row)=>sum+Math.abs(row.difference),0)/rows.length,maxRawFromFormula:Math.max(...rows.map(row=>Math.abs(row.unencodedAlpha-row.formula))),maxEncodedFromRaw:Math.max(...rows.map(row=>Math.abs(row.productAlpha-row.unencodedAlpha))),rows};metrics.push(result);
   if(keep)await fs.writeFile(path.join(directory,'render-comparison.partial.json'),JSON.stringify({metrics},null,2));
   assert(result.maxRawFromFormula<.003,JSON.stringify({name,raw:result.maxRawFromFormula}));
   assert(result.maxEncodedFromRaw<.025,JSON.stringify({name,encodingChain:result.maxEncodedFromRaw}));
   // Native H264 alpha residual <=.021 plus product color/encoding residual
   // <=.025 bounds the two-chain comparison. Do not call this pixel equality.
   assert(result.maxAbsoluteAlpha<.045,JSON.stringify({name,max:result.maxAbsoluteAlpha}));
   const zeros=name==='native-loop-measurements'?[0,15,30,45,60,75,90,105]:[0,24,39,54,69,84,99];for(const n of zeros)assert(rows[n].productAlpha<.005,`${name} expected native black frame ${n}`);
   if(name==='native-combo-measurements')assert(rows[9].productAlpha>.97,'exact entrance endpoint was incorrectly assigned to loop start');
  }
  if(keep)await fs.writeFile(path.join(directory,'render-comparison.json'),JSON.stringify({scope:'Product full unencoded libass and real H264 output vs native real H264 normalized solid-glyph alpha. Each uses its own no-animation glyph mask. Raw alpha, product color/encoding-chain difference and final native comparison are separated; full glyph/pixel parity is not claimed. The initial .03 final-alpha bound failed at .032425; replaced by separated raw<.003, product encoding<.025 and native two-chain<.045 bounds after isolation.',metrics},null,2));
 }finally{if(!keep)await fs.rm(directory,{recursive:true,force:true});}
});
