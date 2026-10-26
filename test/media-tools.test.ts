import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {startServer} from '../apps/service/server.ts';import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';import {runProcess} from '../packages/media/src/process.ts';import {emptyDocument} from '../packages/core/src/document.ts';
test('read-only media-tool inspection proves actual CFR, rejects VFR/missing/changed files and never edits the project',{timeout:30000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yx-media-tools-')),app=await startServer({root,port:0});try{
  const file=path.join(root,'regular.mkv'),vfrFile=path.join(root,'irregular.mkv');await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i','testsrc2=s=64x48:r=30:d=0.4','-c:v','ffv1',file]);await runProcess(ffmpeg(),['-v','error','-y','-i',file,'-vf',"select='not(eq(n,4))'",'-fps_mode','vfr','-c:v','ffv1',vfrFile]);
  const a=await probeAsset(file),b=await probeAsset(vfrFile);await app.store.addAsset(a);await app.store.addAsset(b);const d=emptyDocument();d.assets=[a,b];const project=await app.store.create(d),before=app.store.state(project.id);
  const get=async(id:string)=>{const response=await fetch(`${app.origin}/api/projects/${project.id}/media-tools?assetId=${id}`);assert(response.ok);return response.json();};
  assert.deepEqual(await get(a.id),{reason:'',fileReason:'',frames:12});assert.deepEqual(await get(a.id),{reason:'',fileReason:'',frames:12});
  assert.deepEqual(await get(b.id),{reason:'MEDIA_OPERATION_FRAME_TIMING',fileReason:''});
  await fs.rename(file,file+'.backup');assert.equal((await get(a.id)).reason,'MEDIA_SOURCE_MISSING');await fs.copyFile(vfrFile,file);assert.equal((await get(a.id)).reason,'MEDIA_HASH_CHANGED');
  await fs.copyFile(file+'.backup',file);assert.equal((await get(a.id)).reason,'');assert.deepEqual(app.store.state(project.id),before);
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});
