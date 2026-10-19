import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startServer} from '../apps/service/server.ts';

test('real HTTP workflow persists commands, renders media and serves valid byte ranges', {timeout: 120000}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yingxu-http-'));
  const app = await startServer({root, port: 0});
  try {
    const bootstrap = await (await fetch(app.origin + '/api/bootstrap')).json() as any;
    const post = async (url: string, data: unknown = {}) => {
      const response = await fetch(app.origin + url, {method: 'POST', headers: {'Content-Type': 'application/json', 'x-editor-token': bootstrap.token}, body: JSON.stringify(data)});
      const result = await response.json() as any; assert(response.ok, JSON.stringify(result)); return result;
    };
    const demo = await post('/api/demo'), id = demo.project.id;
    const state = await post(`/api/projects/${id}/commands`, {revision: 0, requestId: 'rename', command: {type: 'project.settings', title: 'HTTP真实工程'}});
    assert.equal(state.revision, 1);
    const job = await post(`/api/projects/${id}/jobs`, {revision: 1, requestId: 'export-one', kind: 'export'});
    const duplicate = await post(`/api/projects/${id}/jobs`, {revision: 1, requestId: 'export-one', kind: 'export'}); assert.equal(duplicate.id, job.id);
    const conflict=await fetch(app.origin+`/api/projects/${id}/jobs`,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':bootstrap.token},body:JSON.stringify({revision:1,requestId:'export-one',kind:'export',exportSettings:{format:'mp3'}})});
    assert.equal(conflict.status,409);assert.equal((await conflict.json() as any).error,'REQUEST_ID_CONFLICT');
    const queued = await post(`/api/projects/${id}/jobs`, {revision: 1, requestId: 'export-cancelled', kind: 'export'});
    const cancelled = await post(`/api/jobs/${queued.id}/cancel`); assert.equal(cancelled.status,'cancelled');
    let result: any;
    const deadline = Date.now() + 60000;
    do {
      result = await (await fetch(app.origin + '/api/jobs/' + job.id)).json();
      if (['completed', 'failed', 'cancelled'].includes(result.status)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.result.frameCount, 180);
    const range = await fetch(app.origin + result.result.url, {headers: {Range: 'bytes=0-99'}});
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
    assert.match(range.headers.get('content-range')!, /^bytes 0-99\//);
    const suffix = await fetch(app.origin + result.result.url, {headers: {Range: 'bytes=-50'}});
    assert.equal(suffix.status, 206); assert.equal((await suffix.arrayBuffer()).byteLength, 50);
    const invalid = await fetch(app.origin + result.result.url, {headers: {Range: 'bytes=999999999999-'}}); assert.equal(invalid.status, 416);
    const head = await fetch(app.origin + result.result.url, {method: 'HEAD'}); assert.equal(head.status, 200); assert(Number(head.headers.get('content-length')) > 100);
    for(const format of ['mp3','gif']){
      const configuration={format,range:{start:{numerator:'1',denominator:'1'},duration:{numerator:'1',denominator:'1'}}};
      const next=await post(`/api/projects/${id}/jobs`,{revision:1,requestId:'format-'+format,kind:'export',exportSettings:configuration});
      assert.equal(next.exportSettings.format,format);assert.equal(next.resolvedExport.duration,1);
      let output:any;const limit=Date.now()+30000;
      do{output=await(await fetch(app.origin+'/api/jobs/'+next.id)).json();if(['completed','failed'].includes(output.status))break;await new Promise(r=>setTimeout(r,50));}while(Date.now()<limit);
      assert.equal(output.status,'completed',JSON.stringify(output));assert.equal(output.result.extension,format);
      const download=await fetch(app.origin+output.result.downloadUrl+'?name=真实成果');
      assert.equal(download.headers.get('content-type'),format==='gif'?'image/gif':'audio/mpeg');
      assert.match(download.headers.get('content-disposition')!,new RegExp('\\.'+format));
      const bytes=new Uint8Array(await download.arrayBuffer());assert(bytes.length>100);
      if(format==='gif'){assert.equal(new TextDecoder().decode(bytes.slice(0,6)),'GIF89a');assert.equal(output.result.duration,1);}
      const stored=JSON.parse(await fs.readFile(path.join(root,'jobs',next.id,'job.json'),'utf8'));assert.equal(stored.exportSettings.format,format);assert.equal(stored.documentRevision,1);
    }
    assert.equal((await fetch(app.origin + '/api/projects', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 403);
  } finally {await app.close(); await fs.rm(root, {recursive: true, force: true});}
});
test('service shutdown finishes even if a paused media client still holds a connection', {timeout:10000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-close-'));let socket:http.IncomingMessage|undefined;
  const large=await fs.open(path.join(root,'large.bin'),'w');await large.truncate(64*1024*1024);await large.close();
  const app=await startServer({root:path.join(root,'data'),port:0,dist:root});
  try{
    socket=await new Promise<http.IncomingMessage>((resolve,reject)=>{const req=http.get(app.origin+'/large.bin',response=>{response.pause();resolve(response);});req.on('error',reject);});
    const started=Date.now();await app.close();assert(Date.now()-started<2000,'shutdown waited for a paused video connection');
  }finally{socket?.destroy();await app.close();await fs.rm(root,{recursive:true,force:true});}
});
