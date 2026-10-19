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

test('actual ASS typewriter holds the complete line layout and reveals each glyph on observed native frames',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-text-animation-'));
 try{
  const doc=emptyDocument();doc.canvas={width:320,height:180};doc.fps=r(30);doc.assets=[{id:'text',path:'',kind:'text',duration:r(2)}];
  doc.tracks=[{id:'t',kind:'text',clips:[{id:'c',materialId:'text',source:{start:r(0),duration:r(2)},target:{start:r(0),duration:r(2)},speed:r(1),editableTiming:true,transform:defaultTransform(),text:{content:'ABCDEF',font:'Arial',size:40,color:'#ffffff',outline:0,shadow:0}}]}];
  const raw=async(file:string,name:string)=>{const output=path.join(directory,name);await runProcess(ffmpeg(),['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','-threads','1',output],{timeout:30000});return fs.readFile(output);};
  const base=await render(doc,path.join(directory,'base'));
  const reference=(await raw(base.path,'base.rgb')).subarray(0,320*180*3);
  const mask=new Array(320).fill(false);for(let x=0;x<320;x++)for(let y=0;y<180;y++)if(reference[(y*320+x)*3]>230)mask[x]=true;
  const ranges:{start:number;end:number}[]=[];for(let x=0;x<320;){if(!mask[x]){x++;continue;}const start=x;while(x<320&&mask[x])x++;ranges.push({start,end:x});}
  assert.equal(ranges.length,6);
  doc.tracks[0].clips[0].textAnimations=[{phase:'in',kind:'typewriter',duration:r(1,2)}];
  const typed=await render(doc,path.join(directory,'typed')),frames=await raw(typed.path,'typed.rgb');assert.equal(frames.length,60*320*180*3);
  for(const [i,{start,end}]of ranges.entries()){
   const first=[3,5,7,9,11,13][i],indices:number[]=[];
   for(let x=start;x<end;x++)for(let y=0;y<180;y++)if(reference[(y*320+x)*3]>230)indices.push((y*320+x)*3);
   const mean=(frame:number)=>indices.reduce((n,p)=>n+frames[frame*320*180*3+p],0)/indices.length;
   assert.ok(mean(first-1)<3,`glyph ${i} revealed early`);assert.ok(mean(first)>225,`glyph ${i} moved or missing on frame ${first}`);
  }
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
