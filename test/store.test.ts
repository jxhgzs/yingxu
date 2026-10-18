import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../apps/service/store.ts';

test('disk transactions survive restart, deduplicate retries, and serialize conflicts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yingxu-store-'));
  try {
    const s = new Store(root); await s.initialize(); const p = await s.create();
    const request = {revision: 0, requestId: 'rename-one', command: {type: 'project.settings' as const, title: '保存后的标题'}};
    const a = await s.edit(p.id, request); assert.equal(a.revision, 1);
    const duplicate = await s.edit(p.id, request); assert.equal(duplicate.revision, 1);
    const restarted = new Store(root); await restarted.initialize(); assert.equal(restarted.state(p.id).document.title, '保存后的标题');
    assert.equal((await restarted.edit(p.id, request)).revision, 1);
    await assert.rejects(restarted.edit(p.id, {...request, command: {...request.command, title: '不同内容'}}), /REQUEST_ID_CONFLICT/);
    await restarted.edit(p.id, {revision: 1, requestId: 'undo-one', action: 'undo'});
    assert.equal(restarted.state(p.id).document.title, '未命名工程');
    const results = await Promise.allSettled([1, 2].map(i => restarted.edit(p.id, {revision: 2, requestId: 'parallel-' + i, command: {type: 'project.settings', title: String(i)}})));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(restarted.state(p.id).revision, 3);
  } finally {await fs.rm(root, {recursive: true, force: true});}
});
