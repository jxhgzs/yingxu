import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {render} from '../packages/media/src/render.ts';import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';import {importJianying} from '../packages/jianying/src/import.ts';import {rational,div} from '../packages/core/src/time.ts';import {baselineRoot} from './fixtures.ts';
const expected=[...Array.from({length:25},(_,i)=>i),26,29,32,37,42,47,52,57,60,63,65,...Array.from({length:23},(_,i)=>i+66)];
function decode(file:string){const r=spawnSync(ffmpeg(),['-v','error','-i',file,'-vf','scale=80:45:flags=area','-an','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr.toString());return r.stdout;}
test('independent curve render selects all 59 source frames observed in native export',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-native-'));try{
  const raw=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-curve/02-middle-raised.json',import.meta.url),'utf8')),doc=importJianying(raw).document,clip=doc.tracks.at(-1)!.clips[0];
  const source=await probeAsset(path.join(baselineRoot,'fixtures/timeline-probe.mp4'));source.hasAudio=false;clip.materialId=source.id;clip.target.start=rational(0);doc.assets=[source];doc.tracks=[{id:'curve',kind:'video',clips:[clip]}];
  const output=await render(doc,root);assert.equal(output.frameCount,59);const frames=decode(output.path),reference=decode(source.path),stride=80*45*3;assert.equal(frames.length/stride,expected.length);
  for(let i=0;i<expected.length;i++){let best=-1,bestError=Infinity;for(let candidate=0;candidate<90;candidate++){let error=0;for(let j=0;j<stride;j++)error+=Math.abs(frames[i*stride+j]-reference[candidate*stride+j]);if(error<bestError){best=candidate;bestError=error;}}assert.equal(best,expected[i],`curve frame ${i}`);}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('curve render integrates separate audio inputs, source-clock volume and monotonic progress',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-av-'));try{
  const raw=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-curve/02-middle-raised.json',import.meta.url),'utf8')),doc=importJianying(raw).document,clip=doc.tracks.at(-1)!.clips[0];
  const source=await probeAsset(path.join(baselineRoot,'fixtures/timeline-probe.mp4'));assert.equal(source.hasAudio,true);
  clip.materialId=source.id;clip.target.start=rational(1);clip.animations=[{property:'volume',points:[{id:'mute',time:rational(0),value:0,interpolation:'hold'},{id:'loud',time:rational(9,10),value:1,interpolation:'hold'}]}];
  const head={...structuredClone(clip),id:'constant',source:{start:rational(3),duration:rational(1)},target:{start:rational(0),duration:rational(1)},speed:rational(1),speedCurve:undefined,animations:undefined};
  doc.assets=[source];doc.tracks=[{id:'main',kind:'video',clips:[head,clip]}];const progress:number[]=[];
  const output=await render(doc,root,{onProgress:p=>progress.push(p)});assert.equal(output.frameCount,89);assert.equal(progress.at(-1),1);assert(progress.every((v,i)=>i===0||v>=progress[i-1]));
  const filter=await fs.readFile(path.join(root,'filter.txt'),'utf8');assert.match(filter,/\[1:a\]asetpts=PTS-STARTPTS,volume='st/);assert.match(filter,/\[0:a\]atrim/);
  const r=spawnSync(ffmpeg(),['-v','error','-i',output.path,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stderr.toString());
  const rms=(at:number)=>{let power=0;for(let i=Math.round(at*48000);i<Math.round((at+.1)*48000);i++)power+=r.stdout.readFloatLE(i*4)**2;return Math.sqrt(power/4800);};
  assert(rms(.4)>.01,'constant audio missing');assert(rms(1.2)<.0001,'curve volume ignored its source clock');assert(rms(2.7)>.01,'curve audio missing');
  const graph=JSON.parse(await fs.readFile(path.join(root,'graph.json'),'utf8'));assert.deepEqual(graph.document.tracks[0].clips[1].speed,div(clip.source.duration,clip.target.duration));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('curve trim preserves all 27 native frame choices with a fractional source in-point and covered-source overrun',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-curve-trim-'));try{
  const raw=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-curve-trim/03-second-left-edge-drag.json',import.meta.url),'utf8'));
  raw.tracks=raw.tracks.filter((t:any)=>t.type==='video');const imported=importJianying(raw);assert.deepEqual(imported.diagnostics,[]);
  const doc=imported.document,clip=doc.tracks.at(-1)!.clips[1];
  const source=await probeAsset(path.join(baselineRoot,'fixtures/timeline-probe.mp4'));source.hasAudio=false;clip.materialId=source.id;clip.target.start=rational(0);doc.assets=[source];doc.tracks=[{id:'trimmed',kind:'video',clips:[clip]}];
  assert.deepEqual(clip.source.start,rational(1452153,1000000));
  const native=[43,46,51,56,61,65,68,70,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90];
  const output=await render(doc,root);assert.equal(output.frameCount,27);const frames=decode(output.path),reference=decode(source.path),stride=80*45*3;
  for(let i=0;i<native.length;i++){let best=-1,bestError=Infinity;for(let candidate=0;candidate<100;candidate++){let error=0;for(let j=0;j<stride;j++)error+=Math.abs(frames[i*stride+j]-reference[candidate*stride+j]);if(error<bestError){best=candidate;bestError=error;}}assert.equal(best,native[i],`trimmed curve frame ${i}`);}
  // The last visible frame uses source 3s, beyond the declared trim's half-open end.
  source.hasAudio=true;const av=await render(doc,path.join(root,'av'));assert.equal(av.frameCount,27);assert(av.info.streams.some((s:any)=>s.codec_type==='audio'));
  source.duration=rational(3);await assert.rejects(render(doc,path.join(root,'short')),/CURVE_SOURCE_COVERAGE_EXCEEDED/);
  const animation=raw.materials.material_animations.find((a:any)=>a.id===raw.tracks.at(-1).segments[1].extra_material_refs.find((id:string)=>raw.materials.material_animations.some((a:any)=>a.id===id)));
  animation.animations=[{type:'unverified'}];assert(importJianying(raw).diagnostics.some(d=>d.code==='VISUAL_SEMANTICS_NOT_INTERPRETED'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
