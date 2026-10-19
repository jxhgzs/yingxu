import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {render} from '../packages/media/src/render.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {rational} from '../packages/core/src/time.ts';
import type {Document} from '../packages/core/src/document.ts';
import type {ColorAdjustments} from '../packages/core/src/color-effects.ts';

test('complete float-decode/LUT/composite/encode path retains the nine native SDR patch observations', {timeout:240000},async()=>{
 const evidence=fileURLToPath(new URL('../evidence/2026-10-19-color-patches/',import.meta.url));
 const native=JSON.parse(await fs.readFile(path.join(evidence,'pixels-frame30.json'),'utf8')).samples;
 // This tiny generated fixture is ours. No executable, shader or effect asset
 // from the closed application is needed by this regression.
 const asset=await probeAsset(path.join(evidence,'source.mp4')),directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-native-colors-'));
 const cases:Array<[string,Omit<ColorAdjustments,'version'>]>=[['02-zero.mov',{}],['03-brightness-plus50.mov',{brightness:1}],['04-brightness-minus50.mov',{brightness:-1}],['05-saturation-plus50.mov',{saturation:1}],['06-saturation-minus50.mov',{saturation:-1}],['07-highlights-plus50.mov',{highlight:1}],['08-highlights-minus50.mov',{highlight:-1}],['09-shadows-plus50.mov',{shadow:1}],['10-shadows-minus50.mov',{shadow:-1}]];
 try{for(const [name,parameters] of cases){
  const r=rational,doc:Document={schemaVersion:1,canvas:{width:1280,height:720},fps:r(30),assets:[asset],tracks:[{id:'v',kind:'video',clips:[{id:'clip',materialId:asset.id,source:{start:r(0),duration:r(2)},target:{start:r(0),duration:r(2)},speed:r(1),editableTiming:true,colorAdjustments:{version:'combine-adjust-v2',...parameters}}]}]};
  const work=path.join(directory,name),result=await render(doc,work);
  assert.equal(result.frameCount,60);assert.equal(result.duration,2);
  const video=result.info.streams.find((s:any)=>s.codec_type==='video');
  assert.equal(video.color_space,'bt709');assert.equal(video.color_range,'tv');
  const decoded=spawnSync(ffmpeg(),['-v','error','-ss','1','-i',result.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:5e6,timeout:20000});
  assert.equal(decoded.status,0,decoded.stderr?.toString());assert.equal(decoded.stdout.length,1280*720*3);
  for(const [category,count,y,tolerance] of [['gray',12,180,2],['color',6,540,4]] as const)for(let i=0;i<count;i++){
   const offset=(y*1280+Math.floor((i+.5)*1280/count))*3;
   for(let channel=0;channel<3;channel++)assert.ok(Math.abs(decoded.stdout[offset+channel]-native[name][category][i][channel])<=tolerance,`${name} ${category}${i} channel${channel}: ${decoded.stdout[offset+channel]} vs ${native[name][category][i][channel]}`);
  }
  const metadata=JSON.parse(await fs.readFile(path.join(work,'color-effects.json'),'utf8'));
  assert.equal(metadata[0].compiler,'color-lut1d-v1');assert.equal(metadata[0].neutral,Object.keys(parameters).length===0);
  const script=await fs.readFile(path.join(work,'filter.txt'),'utf8');
  if(Object.keys(parameters).length)assert.ok(script.includes('zscale=matrixin=709')&&script.includes('lut1d=file='));
 }}finally{await fs.rm(directory,{recursive:true,force:true});}
});
