import test from 'node:test';
import assert from 'node:assert/strict';
import {readSnapshot} from './fixtures.ts';
import {importJianying} from '../packages/jianying/src/import.ts';
import {projectTiming} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
import {createSession} from '../packages/core/src/session.ts';

test('undo and redo restore state but never reuse revision numbers', () => {
  const doc = importJianying(readSnapshot('02-split-at-3s.json')).document;
  const s = createSession(doc), id = doc.tracks[0].clips[1].id;
  s.execute(0, {type: 'speed', clipId: id, value: rational(2), shiftFollowing: false});
  s.undo(1); assert.deepEqual(s.snapshot().document, doc); assert.equal(s.snapshot().revision, 2);
  assert.throws(() => s.redo(1), /REVISION_CONFLICT/); s.redo(2);
  assert.deepEqual(projectTiming(s.snapshot().document), projectTiming(importJianying(readSnapshot('03-second-clip-2x.json')).document));
});
test('failed edits leave history unchanged and a new branch clears redo', () => {
  const doc = importJianying(readSnapshot('01-single-video.json')).document;
  const s = createSession(doc), id = doc.tracks[0].clips[0].id;
  assert.throws(() => s.undo(0), /NO_UNDO/); const before = s.snapshot();
  assert.throws(() => s.execute(0, {type: 'split', clipId: id, at: rational(0), rightId: 'right'}));
  assert.deepEqual(s.snapshot(), before);
  s.execute(0, {type: 'split', clipId: id, at: rational(3), rightId: 'right'}); s.undo(1);
  s.execute(2, {type: 'speed', clipId: id, value: rational(2), shiftFollowing: false});
  assert.equal(s.snapshot().canRedo, false); assert.throws(() => s.redo(3), /NO_REDO/);
  const snapshot = s.snapshot(); snapshot.document.tracks.length = 0;
  assert.equal(s.snapshot().document.tracks.length, 1);
});
test('reapplying an unchanged value does not consume undo history', () => {
  const doc = importJianying(readSnapshot('01-single-video.json')).document,s=createSession(doc);
  const before=s.snapshot();s.execute(0,{type:'speed',clipId:doc.tracks[0].clips[0].id,value:rational(1),shiftFollowing:false});
  assert.deepEqual(s.snapshot(),before);
});
