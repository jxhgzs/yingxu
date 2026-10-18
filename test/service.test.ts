import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
    assert.equal((await fetch(app.origin + '/api/projects', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'})).status, 403);
  } finally {await app.close(); await fs.rm(root, {recursive: true, force: true});}
});
