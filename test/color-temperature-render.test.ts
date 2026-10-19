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

test('product float-decode/matrix/clamp/composite/encode path retains nine native temperature observations',{timeout:240000},async t=>{
 const evidence=fileURLToPath(new URL('../evidence/2026-10-19-temperature/',import.meta.url));
 const retained=JSON.parse(await fs.readFile(path.join(evidence,'native-patches.json'),'utf8'));
 const asset=await probeAsset(fileURLToPath(new URL('../evidence/2026-10-19-color-patches/source.mp4',import.meta.url)));
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-native-temperature-product-'));
 let worstGray=0,worstColor=0;
 try{for(const [name,record] of Object.entries(retained.cases) as [string,any][]){
  const parameters:ColorAdjustments={version:'combine-adjust-v2',...record.parameters},r=rational;
  const doc:Document={schemaVersion:1,canvas:{width:1280,height:720},fps:r(30),assets:[asset],tracks:[{id:'v',kind:'video',clips:[{id:'clip',materialId:asset.id,source:{start:r(0),duration:r(2)},target:{start:r(0),duration:r(2)},speed:r(1),editableTiming:true,colorAdjustments:parameters}]}]};
  const work=path.join(directory,name),result=await render(doc,work);assert.equal(result.frameCount,60);assert.equal(result.duration,2);
  const video=result.info.streams.find((s:any)=>s.codec_type==='video');assert.equal(video.color_space,'bt709');assert.equal(video.color_range,'tv');
  const decoded=spawnSync(ffmpeg(),['-v','error','-ss','1','-i',result.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:5e6,timeout:20000});
  assert.equal(decoded.status,0,decoded.stderr?.toString());assert.equal(decoded.stdout.length,1280*720*3);
  for(const [category,count,y,tolerance] of [['gray',12,180,4],['color',6,540,3]] as const)for(let i=0;i<count;i++){
   const offset=(y*1280+Math.floor((i+.5)*1280/count))*3;
   for(let c=0;c<3;c++){
    const error=Math.abs(decoded.stdout[offset+c]-record.native.samples[category][i][c]);if(category==='gray')worstGray=Math.max(worstGray,error);else worstColor=Math.max(worstColor,error);
    assert.ok(error<=tolerance,`${name} ${category}${i} channel${c}: ${decoded.stdout[offset+c]} vs ${record.native.samples[category][i][c]}`);
   }
  }
  const metadata=JSON.parse(await fs.readFile(path.join(work,'color-effects.json'),'utf8'))[0];
  const active=Math.abs(parameters.temperature??0)>1e-5||Math.abs(parameters.tint??0)>1e-5;
  assert.equal(metadata.temperatureMatrix?.length,active?9:undefined);
  if(active){const filter=await fs.readFile(path.join(work,'filter.txt'),'utf8');assert.ok(filter.includes('colorchannelmixer=')&&filter.includes('lut1d=file='));}
 }}finally{await fs.rm(directory,{recursive:true,force:true});}
 t.diagnostic(`Nine native static temperature cases: product export max gray ${worstGray}/255, color ${worstColor}/255 at the retained 18 centers; this is not a full-frame metric.`);
});
