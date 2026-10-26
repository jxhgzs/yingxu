import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {freezeMedia,reverseMedia} from '../packages/media/src/clip-media.ts';import {ffmpeg,probeAsset} from '../packages/media/src/probe.ts';import {runProcess} from '../packages/media/src/process.ts';import {rational as r} from '../packages/core/src/time.ts';import {startServer} from '../apps/service/server.ts';
async function fixture(root:string){const file=path.join(root,'source.mkv');await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i',"nullsrc=s=64x48:r=10:d=1.2,geq=r='N*18':g='255-N*15':b='N*7',format=yuv444p",'-f','lavfi','-i',"aevalsrc='0.2*t':s=48000:d=1.2",'-c:v','ffv1','-c:a','pcm_s16le',file]);return probeAsset(file);}
async function pixels(file:string,root:string,name:string){const raw=path.join(root,name);await runProcess(ffmpeg(),['-v','error','-y','-i',file,'-an','-f','rawvideo','-pix_fmt','rgb24',raw]);return fs.readFile(raw);}
test('freeze takes the selected frame; chunked reverse has no missing/repeated seam frames and reverses audio',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yx-clip-media-'));try{
  const asset=await fixture(root),source=await pixels(asset.path,root,'source.rgb'),still=await freezeMedia(asset,r(3,10),path.join(root,'freeze')),image=await pixels(still,root,'still.rgb');assert.deepEqual(image,source.subarray(3*64*48*3,4*64*48*3));
  const reverse=await reverseMedia(asset,r(2,10),r(8,10),path.join(root,'reverse'),{chunkFrames:3}),output=await pixels(reverse,root,'reverse.rgb');const size=64*48*3;assert.equal(output.length,8*size);
  for(let frame=0;frame<8;frame++){const original=source.subarray((9-frame)*size,(10-frame)*size),actual=output.subarray(frame*size,(frame+1)*size);let max=0;for(let i=0;i<size;i++)max=Math.max(max,Math.abs(actual[i]-original[i]));assert(max<=7,`frame ${frame} max ${max}`);}
  const audio=path.join(root,'audio.f32');await runProcess(ffmpeg(),['-v','error','-y','-i',reverse,'-vn','-ac','1','-f','f32le',audio]);const bytes=await fs.readFile(audio),values=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4),mean=(a:number,b:number)=>values.slice(a,b).reduce((s,n)=>s+n,0)/(b-a);assert(mean(4800,9600)>mean(24000,28800)*1.5,'reversed ramp must descend');
  const abort=new AbortController();abort.abort();await assert.rejects(reverseMedia(asset,r(0),r(1),path.join(root,'cancel'),{signal:abort.signal}),/JOB_CANCELLED/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('freeze/reverse jobs apply one history entry, replay IDs, reject stale revisions and restore after restart',{timeout:90000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yx-derive-api-'));let app=await startServer({root,port:0});try{
  const boot=await(await fetch(app.origin+'/api/bootstrap')).json(),post=async(url:string,data:unknown={})=>{const response=await fetch(app.origin+url,{method:'POST',headers:{'content-type':'application/json','x-editor-token':boot.token},body:JSON.stringify(data)});const result=await response.json();assert(response.ok,JSON.stringify(result));return result;};
  const demo=await post('/api/demo'),id=demo.project.id,clipId=demo.project.document.tracks[0].clips[0].id;
  const wait=async(job:any)=>{for(let i=0;i<200;i++){const current=await(await fetch(app.origin+'/api/jobs/'+job.id)).json();if(!['queued','running','cancelling'].includes(current.status))return current;await new Promise(r=>setTimeout(r,50));}assert.fail('job timed out');};
  const request={kind:'freeze',revision:0,requestId:'one-freeze',clipId,at:r(1)},job=await post(`/api/projects/${id}/jobs`,request);assert.equal((await post(`/api/projects/${id}/jobs`,request)).id,job.id);const done=await wait(job);assert.equal(done.status,'completed',done.error);assert.equal(app.store.state(id).revision,1);assert.equal(app.store.state(id).document.tracks[0].clips.length,3);
  await post(`/api/projects/${id}/commands`,{revision:1,requestId:'undo-freeze',action:'undo'});assert.equal(app.store.state(id).document.tracks[0].clips.length,1);
  const reverse=await post(`/api/projects/${id}/jobs`,{kind:'reverse',revision:2,requestId:'reverse-conflict',clipId});await post(`/api/projects/${id}/commands`,{revision:2,requestId:'race-edit',command:{type:'project.settings',title:'newer'}});const conflict=await wait(reverse);assert.equal(conflict.status,'failed');assert.match(conflict.error,/REVISION_CONFLICT/);assert.equal(app.store.state(id).document.title,'newer');
  // Simulate the crash window after the atomic application, before the final job record.
  const persisted=JSON.parse(await fs.readFile(path.join(root,'jobs',job.id,'job.json'),'utf8'));persisted.status='running';await fs.writeFile(path.join(root,'jobs',job.id,'job.json'),JSON.stringify(persisted));await app.close();app=await startServer({root,port:0});assert.equal(app.jobs.get(job.id).status,'completed');assert.equal(app.store.state(id).revision,3);
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});

test('NTSC with quantized container timestamps remains reversible, and VFR is rejected before output',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yx-ntsc-reverse-'));try{
 const file=path.join(root,'ntsc.mkv');await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i',"nullsrc=s=64x48:r=30000/1001:d=2.2,geq=r='N*3':g=128:b=64,format=yuv444p",'-c:v','ffv1',file]);const asset=await probeAsset(file);const reverse=await reverseMedia(asset,r(1001*37,30000),r(1001*12,30000),path.join(root,'reverse'),{chunkFrames:5});const output=await pixels(reverse,root,'ntsc.rgb');assert.equal(output.length,12*64*48*3);const original=await pixels(file,root,'ntsc-source.rgb');for(let f=0;f<12;f++)assert(Math.abs(output[f*64*48*3]-original[(48-f)*64*48*3])<=7,`NTSC frame ${f}`);
 const irregular=path.join(root,'vfr.mkv');await runProcess(ffmpeg(),['-v','error','-y','-i',file,'-vf',"select='not(eq(n,4))'",'-fps_mode','vfr','-c:v','ffv1',irregular]);const vfr=await probeAsset(irregular);await assert.rejects(reverseMedia(vfr,r(0),r(1,5),path.join(root,'vfr')),/MEDIA_OPERATION_FRAME_TIMING/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
