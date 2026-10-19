import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startServer} from '../apps/service/server.ts';
import {emptyDocument} from '../packages/core/src/document.ts';
import {rational,div} from '../packages/core/src/time.ts';
import {curveDuration} from '../packages/core/src/curve-speed.ts';
import {ffmpeg,probeAsset} from '../packages/media/src/probe.ts';
import {runProcess} from '../packages/media/src/process.ts';
async function document(app:Awaited<ReturnType<typeof startServer>>,root:string){
 const file=path.join(root,'media','curve-source.wav');await runProcess(ffmpeg(),['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=3','-c:a','pcm_f32le',file]);const asset=await probeAsset(file);await app.store.addAsset(asset);const d=emptyDocument();d.assets.push(asset);
 const speedCurve={points:[{x:0,y:1},{x:.5,y:2},{x:1,y:1}]},source=rational(2),target=curveDuration(speedCurve,source,d.fps);d.tracks[1].clips.push({id:'curve',materialId:asset.id,source:{start:rational(0),duration:source},target:{start:rational(0),duration:target},speed:div(source,target),speedCurve,editableTiming:true});return app.store.create(d);
}
test('curve-audio HTTP enforces body/token/revision/material identity and serves verified float32 WAV via HEAD/range',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-http-')),app=await startServer({root,port:0});
 try{const state=await document(app,root),endpoint=`/api/projects/${state.id}/curve-audio`,post=(route:string,data:unknown,token=app.token)=>fetch(app.origin+route,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':token},body:JSON.stringify(data)});
  for(const input of [null,[],{},'string',{revision:0},{revision:0,clipId:1},{revision:-1,clipId:'curve'},{revision:0,clipId:'curve',path:'/private/file'}]){const response=await post(endpoint,input);assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_CURVE_AUDIO_REQUEST');}
  assert.equal((await post(endpoint,{revision:0,clipId:'curve'},'')).status,403);
  const stale=await post(endpoint,{revision:1,clipId:'curve'});assert.equal(stale.status,409);assert.equal((await stale.json()).error,'REVISION_CONFLICT');
  const absent=await post('/api/projects/00000000-0000-0000-0000-000000000000/curve-audio',{revision:0,clipId:'curve'});assert.equal(absent.status,404);assert.equal((await absent.json()).error,'PROJECT_NOT_FOUND');
  const wrong=await post(endpoint,{revision:0,clipId:'absent'});assert.equal(wrong.status,400);assert.equal((await wrong.json()).error,'CURVE_AUDIO_AUDIBLE_CURVE_REQUIRED');
  const response=await post(endpoint,{revision:0,clipId:'curve'});assert.equal(response.status,200);const audio=await response.json();assert.match(audio.url,/^\/curve-audio\/[a-f0-9]{64}\.wav$/);assert.equal(audio.revision,0);assert.equal(audio.clipId,'curve');assert.equal(audio.sampleRate,44100);assert.equal(audio.duration,audio.sampleCount/44100);
  const wav=await fetch(app.origin+audio.url);assert.equal(wav.status,200);assert.equal(wav.headers.get('content-type'),'audio/wav');assert.equal(wav.headers.get('x-content-type-options'),'nosniff');const bytes=Buffer.from(await wav.arrayBuffer());assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
  const head=await fetch(app.origin+audio.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await fetch(app.origin+audio.url,{headers:{Range:'bytes=0-11'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,12));assert.equal((await fetch(app.origin+'/curve-audio/'+'0'.repeat(64)+'.wav')).status,404);
  const project=await fetch(app.origin+`/api/projects/${state.id}`);assert.equal((await project.json()).jobs.length,0);assert.equal(app.store.assets.size,1);
  const p=app.store.get(state.id);p.document.assets[0].path='/private/forged.wav';const forged=await post(endpoint,{revision:0,clipId:'curve'});assert.equal(forged.status,400);assert.equal((await forged.json()).error,'MEDIA_NOT_LINKED');
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});
test('disconnecting curve-audio HTTP cancels its own active R3 process and cleans the unpublished sidecar',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'curve-http-cancel-')),previous=process.env.YINGXU_RUBBERBAND,binary=path.join(root,'blocking-engine'),marker=path.join(root,'started.json');let app:Awaited<ReturnType<typeof startServer>>|undefined,request:http.ClientRequest|undefined;
 try{await fs.writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid}));setTimeout(()=>{},60000);\n`,{mode:0o700});process.env.YINGXU_RUBBERBAND=binary;app=await startServer({root,port:0});const state=await document(app,root);
  request=http.request(app.origin+`/api/projects/${state.id}/curve-audio`,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':app.token}},response=>response.resume());request.on('error',()=>{});request.end(JSON.stringify({revision:0,clipId:'curve'}));
  const deadline=Date.now()+10000;while(Date.now()<deadline){if(await fs.stat(marker).catch(()=>undefined))break;await new Promise(r=>setTimeout(r,5));}const {pid}=JSON.parse(await fs.readFile(marker,'utf8'));request.destroy();let entries:string[]=[];
  const until=Date.now()+10000;do{entries=await fs.readdir(path.join(root,'curve-audio')).catch(()=>[]);if(entries.length===0)break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<until);
  assert.deepEqual(entries,[]);assert.throws(()=>process.kill(pid,0),/ESRCH/);assert.equal((await fetch(app.origin+`/api/projects/${state.id}`)).status,200);assert.equal(app.store.assets.size,1);
 }finally{request?.destroy();await app?.close();if(previous===undefined)delete process.env.YINGXU_RUBBERBAND;else process.env.YINGXU_RUBBERBAND=previous;await fs.rm(root,{recursive:true,force:true});}
});
