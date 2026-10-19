import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {render} from '../packages/media/src/render.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {rational} from '../packages/core/src/time.ts';
import {applyColorAdjustments} from '../packages/core/src/color-effects.ts';
import {applyContrastChannel} from '../packages/core/src/color-contrast.ts';
import type {ColorAdjustments} from '../packages/core/src/color-effects.ts';
import type {Document} from '../packages/core/src/document.ts';
const evidence=fileURLToPath(new URL('../evidence/2026-10-19-contrast/native-patches.json',import.meta.url));
const sourcePath=fileURLToPath(new URL('../evidence/2026-10-19-color-patches/source.mp4',import.meta.url));
type Samples={gray:number[][];color:number[][]};
function maximumError(actual:Samples,reference:Samples,kind:'gray'|'color'){
 return Math.max(...actual[kind].flatMap((rgb,i)=>rgb.map((v,c)=>Math.abs(v-reference[kind][i][c]))));
}

test('complete contrast-v3 render matches four native settings; B→C combination keeps its explicit 3-LSB gray limitation',{timeout:150000},async()=>{
 const observations=JSON.parse(await fs.readFile(evidence,'utf8'));
 assert.equal(createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex'),observations.source.sha256);
 const asset=await probeAsset(sourcePath);asset.hasAudio=false;
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-native-contrast-'));
 const cases:Array<[string,Omit<ColorAdjustments,'version'>,number,number]>=[
  ['contrast-plus50',{contrast:1},2,4],['contrast-plus25',{contrast:.5},2,4],
  ['contrast-minus25',{contrast:-.5},2,4],['contrast-minus50',{contrast:-1},2,4],
  // This combination has a measured three-level gray difference. It does not
  // meet the four single-setting cases' two-level gray parity threshold.
  ['brightness50-contrast50',{brightness:1,contrast:1},3,4],
 ];
 try{for(const [name,parameters,grayTolerance,colorTolerance]of cases){
  const native=observations.cases[name].native;
  const recordedVideo=native.probe.streams.find((s:any)=>s.codec_type==='video');assert.equal(recordedVideo.nb_read_frames,'60');assert.equal(recordedVideo.r_frame_rate,'30/1');
  const effects=native.materialSummary.tracks[0].segments[0].effects;
  assert(effects.some((e:any)=>e.type==='contrast'&&e.version==='v3'&&Math.abs(e.value-parameters.contrast!)<1e-12));
  const r=rational,doc:Document={schemaVersion:1,canvas:{width:1280,height:720},fps:r(30),assets:[asset],tracks:[{id:'v',kind:'video',clips:[{id:'clip',materialId:asset.id,source:{start:r(0),duration:r(2)},target:{start:r(0),duration:r(2)},speed:r(1),editableTiming:true,colorAdjustments:{version:'combine-adjust-v2',...parameters}}]}]};
  const work=path.join(directory,name),output=await render(doc,work);assert.equal(output.frameCount,60);assert.equal(output.duration,2);
  const video=output.info.streams.find((s:any)=>s.codec_type==='video');assert.equal(video.color_space,'bt709');assert.equal(video.color_range,'tv');
  const decoded=spawnSync(ffmpeg(),['-v','error','-ss','1','-i',output.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:5e6,timeout:20000});assert.equal(decoded.status,0,decoded.stderr.toString());assert.equal(decoded.stdout.length,1280*720*3);
  const actual=Object.fromEntries((['gray','color']as const).map(kind=>{const count=kind==='gray'?12:6,y=kind==='gray'?180:540;return [kind,Array.from({length:count},(_,i)=>{const offset=(y*1280+Math.floor((i+.5)*1280/count))*3;return [...decoded.stdout.subarray(offset,offset+3)];})];})) as Samples;
  for(const [kind,tolerance]of [['gray',grayTolerance],['color',colorTolerance]]as const){const error=maximumError(actual,native.samples,kind);assert(error<=tolerance,`${name} ${kind} maximum ${error} exceeds ${tolerance}`);}
  const metadata=JSON.parse(await fs.readFile(path.join(work,'color-effects.json'),'utf8'));assert.equal(metadata[0].compiler,'color-lut1d-v1');assert.equal(metadata[0].neutral,false);
  const script=await fs.readFile(path.join(work,'filter.txt'),'utf8');assert(script.includes('zscale=matrixin=709')&&script.includes('lut1d=file='));
 }}finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('native combination strongly distinguishes B→C from C→B without treating codec RGB as pre-effect float',{timeout:10000},async()=>{
 const observations=JSON.parse(await fs.readFile(evidence,'utf8')),source=observations.source.samples as Samples,native=observations.cases['brightness50-contrast50'].native.samples as Samples;
 const calculate=(reverse:boolean)=>Object.fromEntries((['gray','color']as const).map(kind=>[kind,source[kind].map(rgb=>{
  const input=rgb.map(v=>Math.max(0,Math.min(1,v))) as [number,number,number];
  const output=reverse?applyColorAdjustments(input.map(v=>applyContrastChannel(v,1)) as [number,number,number],{version:'combine-adjust-v2',brightness:1}):applyColorAdjustments(input,{version:'combine-adjust-v2',brightness:1,contrast:1});return output.map(v=>v*255);
 })])) as Samples;
 const forward=calculate(false),reverse=calculate(true),max=(v:Samples)=>Math.max(maximumError(v,native,'gray'),maximumError(v,native,'color'));
 assert(max(reverse)>140);assert(max(forward)<5);assert(max(reverse)>max(forward)*30);
});
