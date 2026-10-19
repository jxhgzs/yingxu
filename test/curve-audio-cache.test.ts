import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CurveAudioRenders} from '../apps/service/curve-audio.ts';
import {Store} from '../apps/service/store.ts';
import {emptyDocument} from '../packages/core/src/document.ts';
import {rational,div} from '../packages/core/src/time.ts';
import {curveDuration} from '../packages/core/src/curve-speed.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {runProcess} from '../packages/media/src/process.ts';
import {inspectPreviewCurveAudio} from '../packages/media/src/preview-curve-audio.ts';
async function fixture(root:string){
 const store=new Store(root);await store.initialize();const file=path.join(root,'media','tone.wav');await runProcess(ffmpeg(),['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=3','-c:a','pcm_f32le',file]);
 const asset=await probeAsset(file);await store.addAsset(asset);const d=emptyDocument();d.assets.push(asset);const curve={points:[{x:0,y:1},{x:.5,y:2},{x:1,y:1}]},source=rational(2),target=curveDuration(curve,source,d.fps);
 d.tracks[1].clips.push({id:'curve',materialId:asset.id,source:{start:rational(0),duration:source},target:{start:rational(0),duration:target},speed:div(source,target),speedCurve:curve,editableTiming:true,volume:.2,audioFade:{curve:'qsin',inDuration:rational(1,5),outDuration:rational(1,5)}});
 return {store,d,asset,state:await store.create(d)};
}
test('curve sidecar cache renders real neutral float32 stereo, binds revision/engine/hash and detects corrupt payload',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-cache-'));let cache:CurveAudioRenders|undefined,cache2:CurveAudioRenders|undefined;
 try{const {store,state,d}=await fixture(root);cache=new CurveAudioRenders(store,{engine:'engine-one'});const result=await cache.request(state.id,{revision:0,clipId:'curve'}),file=await cache.file(result.key),info=await inspectPreviewCurveAudio(file),mtime=(await fs.stat(file)).mtimeMs;
  assert.equal(result.sampleRate,44100);assert.equal(result.sampleCount,info.sampleCount);assert.equal(result.duration,result.sampleCount/44100);assert(Math.abs(result.sampleCount-Number(d.tracks[1].clips[0].target.duration.numerator)/Number(d.tracks[1].clips[0].target.duration.denominator)*44100)<=1);
  assert.equal(store.assets.size,1,'sidecar is not registered as a material');assert.equal(store.list().length,1);assert.equal((await cache.request(state.id,{revision:0,clipId:'curve'})).key,result.key);assert.equal((await fs.stat(file)).mtimeMs,mtime);
  // Live clip gain and fade are deliberately not baked: compare bytes from a project with unity gain/no fade.
  const neutral=structuredClone(d);neutral.tracks[1].clips[0].volume=1;delete neutral.tracks[1].clips[0].audioFade;const state2=await store.create(neutral),neutralResult=await cache.request(state2.id,{revision:0,clipId:'curve'});assert.deepEqual(await fs.readFile(await cache.file(neutralResult.key)),await fs.readFile(file));
  cache2=new CurveAudioRenders(store,{engine:'engine-two'});assert.notEqual((await cache2.request(state.id,{revision:0,clipId:'curve'})).key,result.key);
  await fs.appendFile(file,'bad');await assert.rejects(cache.file(result.key),/CURVE_AUDIO_CACHE_INVALID/);
 }finally{await cache?.shutdown();await cache2?.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
test('curve sidecars reject invalid requests, stale/unknown/non-audible clips, forged paths and changed source SHA',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-cache-errors-'));let cache:CurveAudioRenders|undefined;
 try{const {store,state,asset}=await fixture(root);cache=new CurveAudioRenders(store,{engine:'test'});
  for(const body of [null,[],{},'string',{revision:0},{revision:0,clipId:1},{revision:-1,clipId:'curve'},{revision:0,clipId:'curve',path:'/private/file'}])await assert.rejects(cache.request(state.id,body as any),/INVALID_CURVE_AUDIO_REQUEST/);
  await assert.rejects(cache.request('missing',{revision:0,clipId:'curve'}),/PROJECT_NOT_FOUND/);await assert.rejects(cache.request(state.id,{revision:1,clipId:'curve'}),/REVISION_CONFLICT/);await assert.rejects(cache.request(state.id,{revision:0,clipId:'missing'}),/CURVE_AUDIO_AUDIBLE_CURVE_REQUIRED/);
  const p=store.get(state.id);p.document.tracks[1].muted=true;await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'}),/CURVE_AUDIO_AUDIBLE_CURVE_REQUIRED/);p.document.tracks[1].muted=false;
  p.document.assets[0].path='/private/forged.wav';await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'}),/MEDIA_NOT_LINKED/);p.document.assets[0].path=asset.path;
  p.diagnostics=[{code:'UNKNOWN_EFFECT'}];await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'}),/UNSUPPORTED_DRAFT_EFFECTS/);p.diagnostics=[];
  const abort=new AbortController();abort.abort();await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'},abort.signal),/Aborted/);assert.deepEqual(await fs.readdir(root).then(files=>files.filter(f=>f==='curve-audio')),[]);
  await fs.appendFile(asset.path,'changed');await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'}),/MEDIA_HASH_CHANGED/);
  await assert.rejects(cache.file('../bad'),/INVALID_CURVE_AUDIO_KEY/);
 }finally{await cache?.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
test('curve request queue is bounded, stopped requests clean all work and oversized clips are rejected before rendering',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-cache-bounds-'));let cache:CurveAudioRenders|undefined;
 try{const {store,state}=await fixture(root);cache=new CurveAudioRenders(store,{engine:'test'});const abort=new AbortController();abort.abort();const results=await Promise.allSettled(Array.from({length:33},()=>cache!.request(state.id,{revision:0,clipId:'curve'},abort.signal)));
  assert.equal(results.filter(r=>r.status==='rejected'&&/QUEUE_LIMIT/.test(r.reason.message)).length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.name==='AbortError').length,32);
  const p=store.get(state.id),clip=p.document.tracks[1].clips[0];clip.target.duration=rational(601);clip.source.duration=rational(601);clip.speed=rational(1);p.document.assets[0].duration=rational(602);
  await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'}),/CURVE_AUDIO_PREVIEW_LIMIT/);
  clip.target.duration=rational(300);clip.source.duration=rational(3000);clip.speed=rational(10);clip.speedCurve={points:[{x:0,y:10},{x:1,y:10}]};p.document.assets[0].duration=rational(3001);await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'}),/CURVE_AUDIO_PREVIEW_LIMIT/);
 }finally{await cache?.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
test('active R3 cancellation kills the owned process, removes all temporary files and stale queued revisions do not render',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-cache-cancel-'));let cache:CurveAudioRenders|undefined;const previous=process.env.YINGXU_RUBBERBAND;
 try{const {store,state}=await fixture(root),binary=path.join(root,'blocking-engine'),marker=path.join(root,'started.json');await fs.writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setTimeout(()=>{},60000);\n`,{mode:0o700});process.env.YINGXU_RUBBERBAND=binary;cache=new CurveAudioRenders(store,{engine:'cancel-test'});
  const controller=new AbortController(),first=cache.request(state.id,{revision:0,clipId:'curve'},controller.signal),second=cache.request(state.id,{revision:0,clipId:'curve'});const settled=Promise.allSettled([first,second]);
  const deadline=Date.now()+10000;while(Date.now()<deadline){if(await fs.stat(marker).catch(()=>undefined))break;await new Promise(r=>setTimeout(r,5));}const {pid}=JSON.parse(await fs.readFile(marker,'utf8'));store.get(state.id).revision++;controller.abort();const results=await settled;
  assert.equal(results[0].status,'rejected');assert.match((results[0] as PromiseRejectedResult).reason.message,/JOB_CANCELLED|Aborted/);assert.equal(results[1].status,'rejected');assert.match((results[1] as PromiseRejectedResult).reason.message,/REVISION_CONFLICT/);
  assert.throws(()=>process.kill(pid,0),/ESRCH/);assert.deepEqual(await fs.readdir(path.join(root,'curve-audio')),[]);assert.equal(store.assets.size,1);
 }finally{if(previous===undefined)delete process.env.YINGXU_RUBBERBAND;else process.env.YINGXU_RUBBERBAND=previous;await cache?.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
test('disk cache evicts old entries at 32 items and refuses symlink or metadata tampering',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-cache-disk-'));let cache:CurveAudioRenders|undefined;
 try{const {store,state}=await fixture(root);cache=new CurveAudioRenders(store,{engine:'bounded'});const directory=path.join(root,'curve-audio');await fs.mkdir(directory);for(let i=0;i<33;i++){const key=i.toString(16).padStart(64,'0');await fs.writeFile(path.join(directory,key+'.wav'),'old');await fs.writeFile(path.join(directory,key+'.json'),'{}');}
  const rendered=await cache.request(state.id,{revision:0,clipId:'curve'});assert.equal((await fs.readdir(directory)).filter(f=>f.endsWith('.wav')).length,32);const file=await cache.file(rendered.key),record=path.join(directory,rendered.key+'.json'),saved=await fs.readFile(record);await fs.writeFile(record,'{}');await assert.rejects(cache.file(rendered.key),/CURVE_AUDIO_CACHE_INVALID/);await fs.writeFile(record,saved);
  const alias='f'.repeat(64);await fs.symlink(file,path.join(directory,alias+'.wav'));await fs.writeFile(path.join(directory,alias+'.json'),saved);await assert.rejects(cache.file(alias),/CURVE_AUDIO_CACHE_INVALID/);
 }finally{await cache?.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
test('Rubberband identity is frozen per service instance and a replaced executable cannot reuse an old key',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-cache-engine-')),previous=process.env.YINGXU_RUBBERBAND;let cache:CurveAudioRenders|undefined;
 try{const {store,state}=await fixture(root),binary=path.join(root,'engine-wrapper'),script=`#!${process.execPath}\nconst {spawnSync}=require('node:child_process');const child=spawnSync('/opt/homebrew/bin/rubberband',process.argv.slice(2),{stdio:'inherit'});process.exit(child.status??1);\n`;await fs.writeFile(binary,script,{mode:0o700});process.env.YINGXU_RUBBERBAND=binary;cache=new CurveAudioRenders(store,{engine:'frozen'});
  const first=await cache.request(state.id,{revision:0,clipId:'curve'}),file=await cache.file(first.key),before=(await fs.stat(file)).mtimeMs;assert.equal((await cache.request(state.id,{revision:0,clipId:'curve'})).key,first.key);assert.equal((await fs.stat(file)).mtimeMs,before);
  await fs.writeFile(binary,script+'// replaced executable\n');await assert.rejects(cache.request(state.id,{revision:0,clipId:'curve'}),/CURVE_AUDIO_ENGINE_CHANGED/);
 }finally{if(previous===undefined)delete process.env.YINGXU_RUBBERBAND;else process.env.YINGXU_RUBBERBAND=previous;await cache?.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
