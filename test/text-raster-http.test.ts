import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startServer} from '../apps/service/server.ts';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
import {systemFontEnvironmentIdentity} from '../apps/service/text-raster.ts';
function doc(){const d=emptyDocument();d.canvas={width:320,height:180};d.assets.push({id:'text',kind:'text',duration:rational(3600),path:''});d.tracks[2].clips.push({id:'caption',materialId:'text',source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,transform:defaultTransform(),text:{content:'HTTP 中文文字',font:'Source Han Sans SC Medium',size:24,color:'#ffffff'}});return d;}

test('text raster HTTP validates identity/revision/body/token and serves a genuine transparent PNG with HEAD/range',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-http-')),app=await startServer({root,port:0});
 try{const state=await app.store.create(doc()),endpoint=`/api/projects/${state.id}/textures`;
  const post=(endpoint:string,data:unknown,token=app.token)=>fetch(app.origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':token},body:JSON.stringify(data)});
  for(const data of [null,[],{},'string',{revision:0},{revision:0,clipId:1},{revision:-1,clipId:'caption'},{revision:0,clipId:'caption',path:'/private/not-allowed'}]){
   const response=await post(endpoint,data);assert.equal(response.status,400);assert.equal((await response.json()).error,'INVALID_TEXT_TEXTURE_REQUEST');
  }
  const noToken=await post(endpoint,{revision:0,clipId:'caption'},'');assert.equal(noToken.status,403);
  const stale=await post(endpoint,{revision:1,clipId:'caption'});assert.equal(stale.status,409);assert.equal((await stale.json()).error,'REVISION_CONFLICT');
  const missing=await post('/api/projects/00000000-0000-0000-0000-000000000000/textures',{revision:0,clipId:'caption'});assert.equal(missing.status,404);assert.equal((await missing.json()).error,'PROJECT_NOT_FOUND');
  const wrongClip=await post(endpoint,{revision:0,clipId:'absent'});assert.equal(wrongClip.status,400);assert.equal((await wrongClip.json()).error,'TEXT_RASTER_CLIP_REQUIRED');
  const response=await post(endpoint,{revision:0,clipId:'caption'});assert.equal(response.status,200);const texture=await response.json();assert.match(texture.url,/^\/text-renders\/[a-f0-9]{64}\.png$/);assert.equal(texture.revision,0);assert.equal(texture.clipId,'caption');
  const png=await fetch(app.origin+texture.url);assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/png');assert.equal(png.headers.get('x-content-type-options'),'nosniff');const bytes=Buffer.from(await png.arrayBuffer());assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(bytes.readUInt32BE(16),320);assert.equal(bytes.readUInt32BE(20),180);assert.equal(bytes[25],6,'PNG must use truecolor alpha');
  const head=await fetch(app.origin+texture.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'image/png');assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
  const range=await fetch(app.origin+texture.url,{headers:{Range:'bytes=0-7'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,8));
  const invalid=await fetch(app.origin+'/text-renders/'+'0'.repeat(64)+'.png');assert.equal(invalid.status,404);
  const record=JSON.parse(await fs.readFile(path.join(root,'text-renders',texture.key+'.json'),'utf8'));assert.deepEqual(record.fontEnvironment,systemFontEnvironmentIdentity());
  const p=app.store.get(state.id);p.diagnostics=[{code:'UNKNOWN_EFFECT'}];const unknown=await post(endpoint,{revision:0,clipId:'caption'});assert.equal(unknown.status,400);assert.equal((await unknown.json()).error,'UNSUPPORTED_DRAFT_EFFECTS');
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});

test('disconnecting an active text HTTP request cancels its subprocess and leaves no published or temporary raster',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-http-cancel-')),app=await startServer({root,port:0});let request:http.ClientRequest|undefined;
 try{const d=doc();d.canvas={width:3840,height:2160};d.tracks[2].clips[0].text!.content='待取消的中文 '.repeat(100);const state=await app.store.create(d);
  request=http.request(app.origin+`/api/projects/${state.id}/textures`,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':app.token}},response=>response.resume());request.on('error',()=>{});request.end(JSON.stringify({revision:0,clipId:'caption'}));
  const cache=path.join(root,'text-renders'),deadline=Date.now()+10000;let active=false;
  while(Date.now()<deadline){const entries=await fs.readdir(cache).catch(()=>[]);for(const entry of entries.filter(f=>f.startsWith('.'))){const rendered=await fs.stat(path.join(cache,entry,'black.rgba')).catch(()=>undefined);if(rendered){active=true;break;}}if(active)break;await new Promise(r=>setTimeout(r,5));}
  assert(active,'request never entered the real raster subprocess');request.destroy();
  const until=Date.now()+10000;let entries:string[]=[];
  do{entries=await fs.readdir(cache).catch(()=>[]);if(entries.length===0)break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<until);
  assert.deepEqual(entries,[],'cancelled client published a raster or retained its temporary work directory');
  const project=await fetch(app.origin+`/api/projects/${state.id}`);assert.equal(project.status,200,'service remains usable after client cancellation');assert.equal((await project.json()).jobs.length,0);
 }finally{request?.destroy();await app.close();await fs.rm(root,{recursive:true,force:true});}
});
