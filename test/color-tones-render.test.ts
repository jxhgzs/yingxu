import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {render} from '../packages/media/src/render.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {rational as r} from '../packages/core/src/time.ts';
import type {Document} from '../packages/core/src/document.ts';
import type {ColorAdjustments} from '../packages/core/src/color-effects.ts';

test('product tones path retains seven native black/white/fade and temperature-combination patch observations',{timeout:120000},async t=>{
 const retained=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-color-tones-v8/native-patches.json',import.meta.url),'utf8'));
 const asset=await probeAsset(fileURLToPath(new URL('../evidence/2026-10-19-color-patches/source.mp4',import.meta.url)));
 const keep=process.env.YINGXU_TONES_QA_DIR,directory=keep?path.resolve(keep):await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-tones-render-'));
 let worstGray=0,worstColor=0;const cases:Record<string,unknown>={};
 try{for(const [name,record]of Object.entries(retained.cases) as [string,any][]){
  const parameters:ColorAdjustments={version:'combine-adjust-v2',...record.parameters};
  const doc:Document={schemaVersion:1,canvas:{width:1280,height:720},fps:r(30),assets:[asset],tracks:[{id:'v',kind:'video',clips:[{id:'c',materialId:asset.id,source:{start:r(0),duration:r(2)},target:{start:r(0),duration:r(2)},speed:r(1),editableTiming:true,colorAdjustments:parameters}]}]};
  const work=path.join(directory,name),result=await render(doc,work);assert.equal(result.frameCount,60);assert.equal(result.duration,2);
  const decoded=spawnSync(ffmpeg(),['-v','error','-ss','1','-i',result.path,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:5e6,timeout:20000});assert.equal(decoded.status,0,decoded.stderr?.toString());assert.equal(decoded.stdout.length,1280*720*3);
  const observed:{gray:number[][];color:number[][]}={gray:[],color:[]};let maxGray=0,maxColor=0;
  for(const [category,count,y]of [['gray',12,180],['color',6,540]] as const)for(let i=0;i<count;i++){
   const offset=(y*1280+Math.floor((i+.5)*1280/count))*3,pixel=[...decoded.stdout.subarray(offset,offset+3)];observed[category].push(pixel);
   for(let c=0;c<3;c++){const delta=Math.abs(pixel[c]-record.native.samples[category][i][c]);if(category==='gray')maxGray=Math.max(maxGray,delta);else maxColor=Math.max(maxColor,delta);}
  }
  worstGray=Math.max(worstGray,maxGray);worstColor=Math.max(worstColor,maxColor);cases[name]={parameters,samples:observed,maxGray,maxColor};
  if(keep)await fs.writeFile(path.join(directory,'product-patches.partial.json'),JSON.stringify({cases},null,2));
  assert(maxGray<=4,`${name} native gray difference ${maxGray}`);assert(maxColor<=3,`${name} native color difference ${maxColor}`);
  const metadata=JSON.parse(await fs.readFile(path.join(work,'color-effects.json'),'utf8'))[0];assert.equal(metadata.inputQuantization,parameters.black||parameters.white?'rgb8-nearest':undefined);
 }}finally{if(!keep)await fs.rm(directory,{recursive:true,force:true});}
 if(keep)await fs.writeFile(path.join(directory,'product-patches.json'),JSON.stringify({scope:'Product final Rec709 MP4 RGB center patches vs native final MOV. Existing gray4/color3 bounds retained; not a full-frame metric.',cases},null,2));
 t.diagnostic(`Seven native tones cases: max gray ${worstGray}/255, color ${worstColor}/255 at 18 centers.`);
});
