import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {importJianying} from '../packages/jianying/src/import.ts';import {applyCommand} from '../packages/core/src/commands.ts';import {createSession} from '../packages/core/src/session.ts';import {micros,rational} from '../packages/core/src/time.ts';import {render} from '../packages/media/src/render.ts';import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';import {baselineRoot} from './fixtures.ts';
const id='B71C0B09-4F73-42F1-B889-5767BE0F3825';
async function raw(name:string){const r=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-audio-fade/'+name+'.json',import.meta.url),'utf8'));r.tracks=r.tracks.filter((t:any)=>t.type==='video').slice(0,1);r.tracks[0].segments=r.tracks[0].segments.filter((s:any)=>s.id===id||name==='03-split-2x'&&s.source_timerange?.start===4000000&&s.target_timerange.start===3500000);return r;}
test('native audio fades retain target-clock duration across speed changes and split only outer edges',async()=>{
 const one=importJianying(await raw('01-constant-1x')),two=importJianying(await raw('02-constant-2x'));assert.deepEqual(one.diagnostics,[]);assert.deepEqual(two.diagnostics,[]);
 const fade={curve:'qsin',inDuration:micros(400000),outDuration:micros(400000)};
 assert.deepEqual(one.document.tracks[0].clips[0].audioFade,fade);assert.deepEqual(two.document.tracks[0].clips[0].audioFade,fade);
 const session=createSession(one.document),sped=session.execute(0,{type:'speed',clipId:id,value:rational(2),shiftFollowing:false}).document;
 assert.deepEqual(sped.tracks[0].clips[0].target,two.document.tracks[0].clips[0].target);assert.deepEqual(sped.tracks[0].clips[0].audioFade,fade);assert.deepEqual(session.undo(1).document,one.document);
 const split=applyCommand(two.document,{type:'split',clipId:id,at:micros(3500000),rightId:'right'}),nativeRaw=await raw('03-split-2x');
 const native=importJianying(nativeRaw);assert.deepEqual(native.diagnostics,[]);assert.equal(native.document.tracks[0].clips.length,2);
 for(let i=0;i<2;i++){assert.deepEqual(split.tracks[0].clips[i].audioFade,native.document.tracks[0].clips[i].audioFade);assert.deepEqual(split.tracks[0].clips[i].target,native.document.tracks[0].clips[i].target);}
 const before=structuredClone(one.document);assert.throws(()=>applyCommand(one.document,{type:'speed',clipId:id,value:rational(3),shiftFollowing:false}),/AUDIO_FADE_OVERLAP_UNVERIFIED/);assert.deepEqual(one.document,before);
});
test('unknown or overlapping native fade semantics stay diagnosed rather than silently ignored',async()=>{
 for(const change of [{fade_type:1},{fade_in_duration:-1},{fade_in_duration:Infinity},{fade_in_duration:1700000},{fade_in_duration:1000000,fade_out_duration:1000000}]){
  const r=await raw('01-constant-1x'),s=r.tracks[0].segments[0],f=r.materials.audio_fades.find((f:any)=>s.extra_material_refs.includes(f.id));Object.assign(f,change);
  const imported=importJianying(r);assert(imported.diagnostics.some(d=>d.code==='AUDIO_FADE_UNSUPPORTED'));assert.equal(imported.document.tracks[0].clips[0].audioFade,undefined);
 }
});
test('rendered quarter-sine fades follow the measured 1x and 2x native envelope in target time',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-audio-fade-'));try{
  const measurements=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-audio-fade/observed-envelopes.json',import.meta.url),'utf8'));
  const asset=await probeAsset(path.join(baselineRoot,'fixtures/timeline-probe.mp4'));
  for(const [name,duration] of [['1x',1.666666],['2x',.833333]] as const){
   const doc=importJianying(await raw(name==='1x'?'01-constant-1x':'02-constant-2x')).document,c=doc.tracks[0].clips[0];doc.assets=[asset];c.materialId=asset.id;c.target.start=rational(0);
   const result=await render(doc,path.join(root,name),{exportSettings:{format:'wav',audioSampleRate:48000}});
   assert.equal(path.extname(result.path),'.wav');
   const r=spawnSync(ffmpeg(),['-v','error','-i',result.path,'-ac','1','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr.toString());
   const rms=(t:number)=>{let power=0;const begin=Math.round((t-.005)*48000),end=Math.round((t+.005)*48000);for(let i=begin;i<end;i++)power+=r.stdout.readFloatLE(i*4)**2;return Math.sqrt(power/(end-begin));};
   const reference=rms(name==='1x'?.8:.415);
   for(const v of measurements[name].values){const gain=rms(v.edge==='in'?v.fadeElapsed:duration-v.fadeElapsed)/reference;assert(Math.abs(gain-v.gain)<.035,`${name} ${v.edge} ${v.fadeElapsed}: ${gain} vs native ${v.gain}`);assert(Math.abs(gain-v.qsin)<.035);}
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
