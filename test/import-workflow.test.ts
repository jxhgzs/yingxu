import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startServer} from '../apps/service/server.ts';
import {toNumber} from '../packages/core/src/time.ts';

test('registered relink makes known keyframe drafts editable, exportable and round-trip with original source',{timeout:120000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-draft-workflow-')),app=await startServer({root,port:0});
 try{
  const bootstrap=await(await fetch(app.origin+'/api/bootstrap')).json() as any;
  const post=async(url:string,body:unknown)=>{const r=await fetch(app.origin+url,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':bootstrap.token},body:JSON.stringify(body)}),d=await r.json() as any;assert(r.ok,JSON.stringify(d));return d;};
  const demo=await post('/api/demo',{}),raw=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-expansion/03-copy-2x.json',import.meta.url),'utf8'));
  const imported=await post('/api/import-draft',raw),id=imported.id;assert.deepEqual(imported.diagnostics,[]);
  assert(imported.document.tracks.flatMap((t:any)=>t.clips).some((c:any)=>c.animations?.length));
  const old=structuredClone(imported.document),ids=old.assets.map((a:any)=>a.id);let state=imported;
  for(const assetId of ids){state=await post(`/api/projects/${id}/commands`,{revision:state.revision,requestId:'link-'+assetId,command:{type:'asset.relink',assetId,replacement:{...demo.asset,path:'/untrusted/not-followed',duration:{numerator:'9999',denominator:'1'}}}});}
  assert.equal(state.document.assets.length,1);assert.equal(state.document.assets[0].path,demo.asset.path);assert(state.document.tracks.flatMap((t:any)=>t.clips).every((c:any)=>c.materialId===demo.asset.id));
  const linked=structuredClone(state.document);
  const undo=await post(`/api/projects/${id}/commands`,{revision:state.revision,requestId:'link-undo',action:'undo'});assert(undo.document.assets.length>1);
  state=await post(`/api/projects/${id}/commands`,{revision:undo.revision,requestId:'link-redo',action:'redo'});assert.deepEqual(state.document,linked);
  const job=await post(`/api/projects/${id}/jobs`,{revision:state.revision,requestId:'draft-render',kind:'export'});let result:any;const deadline=Date.now()+60000;
  do{result=await(await fetch(app.origin+'/api/jobs/'+job.id)).json();if(['completed','failed'].includes(result.status))break;await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);
  assert.equal(result.status,'completed',JSON.stringify(result));assert.equal(result.result.frameCount,225);
  const downloaded=await(await fetch(app.origin+`/api/projects/${id}/download`)).json();const reopened=await post('/api/open-document',downloaded);assert.deepEqual(reopened.document,state.document);assert.deepEqual(reopened.diagnostics,[]);
  const original=JSON.parse(await fs.readFile(path.join(root,'projects',reopened.id+'.json'),'utf8'));assert.deepEqual(original.provenance.raw,raw);
  // A wrapped unknown-source project cannot strip its diagnostic to unlock export.
  const unsupported=structuredClone(raw);unsupported.tracks[0].segments[0].clip.rotation=90;
  const guarded=await post('/api/import-draft',unsupported),wrapped=await(await fetch(app.origin+`/api/projects/${guarded.id}/download`)).json() as any;wrapped.diagnostics=[];
  const restored=await post('/api/open-document',wrapped);assert(restored.diagnostics.length>0);
  assert.equal(toNumber(state.document.fps),30);
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});

test('HTTP subtitle command imports once, preserves source through save and restores atomically',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-subtitles-http-')),app=await startServer({root,port:0});
 try{
  const bootstrap=await(await fetch(app.origin+'/api/bootstrap')).json() as any;
  const post=async(url:string,body:unknown)=>{const r=await fetch(app.origin+url,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':bootstrap.token},body:JSON.stringify(body)}),d=await r.json() as any;assert(r.ok,JSON.stringify(d));return d;};
  const p=await post('/api/projects',{}),url=`/api/projects/${p.id}/commands`,input='1\n00:00:00,500 --> 00:00:01,250\n第一行\n第二行\n\n2\n00:00:01,250 --> 00:00:02,000\n字幕结束';
  const body={revision:0,requestId:'subtitle-http',command:{type:'subtitles.import',input,format:'srt',options:{idPrefix:'http'}}};
  const imported=await post(url,body),retried=await post(url,body);assert.equal(imported.revision,1);assert.equal(retried.replayed,true);assert.equal(retried.revision,1);
  assert.equal(imported.document.subtitleSources[0].text,input);
  const undo=await post(url,{revision:1,requestId:'undo-sub',action:'undo'});assert.deepEqual(undo.document,p.document);
  const redo=await post(url,{revision:2,requestId:'redo-sub',action:'redo'});assert.deepEqual(redo.document,imported.document);
  const downloaded=await(await fetch(app.origin+`/api/projects/${p.id}/download`)).json();const reopened=await post('/api/open-document',downloaded);assert.equal(reopened.document.subtitleSources[0].text,input);
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});
test('same-path draft relink is one canonical batch and a locked reference rolls back every replacement',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-relink-batch-')),app=await startServer({root,port:0});
 try{
  const bootstrap=await(await fetch(app.origin+'/api/bootstrap')).json() as any;
  const request=async(url:string,body:unknown)=>{const response=await fetch(app.origin+url,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':bootstrap.token},body:JSON.stringify(body)});return {ok:response.ok,data:await response.json() as any};};
  const demo=(await request('/api/demo',{})).data;
  const raw=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-curve/02-middle-raised.json',import.meta.url),'utf8'));
  const imported=(await request('/api/import-draft',raw)).data,url=`/api/projects/${imported.id}/commands`;
  assert.equal(imported.document.assets.length,6);assert.deepEqual(imported.diagnostics,[]);
  const commands=imported.document.assets.map((a:any)=>({type:'asset.relink',assetId:a.id,replacement:{...demo.asset,path:'/unregistered-ignored.mp4'}}));
  const trackId=imported.document.tracks.at(-1).id;
  const locked=(await request(url,{revision:0,requestId:'lock',command:{type:'track.update',trackId,changes:{locked:true}}})).data;
  const rejected=await request(url,{revision:1,requestId:'locked-batch',command:{type:'batch',commands}});assert.equal(rejected.ok,false);assert.match(rejected.data.error,/TRACK_LOCKED/);
  const unchanged=await(await fetch(app.origin+`/api/projects/${imported.id}`)).json() as any;assert.equal(unchanged.revision,1);assert.deepEqual(unchanged.document,locked.document);
  const linked=(await request(url,{revision:1,requestId:'unlock-link',command:{type:'batch',commands:[{type:'track.update',trackId,changes:{locked:false}},...commands]}})).data;
  assert.equal(linked.revision,2);assert.equal(linked.document.assets.length,1);assert.equal(linked.document.assets[0].path,demo.asset.path);assert(linked.document.tracks.at(-1).clips[0].speedCurve);
  const undo=(await request(url,{revision:2,requestId:'undo-all',action:'undo'})).data;assert.deepEqual(undo.document,locked.document);
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});
