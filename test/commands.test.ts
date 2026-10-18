import test from 'node:test';
import assert from 'node:assert/strict';
import {readSnapshot} from './fixtures.ts';
import {importJianying} from '../packages/jianying/src/import.ts';
import {projectTiming} from '../packages/core/src/document.ts';
import {rational, decimal} from '../packages/core/src/time.ts';
import {applyCommand} from '../packages/core/src/commands.ts';

export function one() {return importJianying(readSnapshot('01-single-video.json')).document;}
test('split and speed reproduce the actual target timing snapshots', () => {
  const original = one(), before = structuredClone(original);
  const split = applyCommand(original, {type: 'split', clipId: original.tracks[0].clips[0].id, at: rational(3), rightId: 'right'});
  assert.deepEqual(projectTiming(split), projectTiming(importJianying(readSnapshot('02-split-at-3s.json')).document));
  const fast = applyCommand(split, {type: 'speed', clipId: 'right', value: rational(2), shiftFollowing: false});
  assert.deepEqual(projectTiming(fast), projectTiming(importJianying(readSnapshot('03-second-clip-2x.json')).document));
  assert.deepEqual(original, before);
});
test('splitting a sped clip with a nonzero source in-point is exact', () => {
  const doc = one(), c = doc.tracks[0].clips[0];
  doc.assets[0].duration = rational(20); c.source = {start: rational(10), duration: rational(6)};
  c.target.duration = rational(3); c.speed = rational(2);
  const result = applyCommand(doc, {type: 'split', clipId: c.id, at: rational(3, 2), rightId: 'right'});
  assert.deepEqual(result.tracks[0].clips.map(c => c.source), [
    {start: rational(10), duration: rational(3)}, {start: rational(13), duration: rational(3)}]);
});
test('1.3 speed does not accumulate floating-point time', () => {
  const d = one(), id = d.tracks[0].clips[0].id;
  const out = applyCommand(d, {type: 'speed', clipId: id, value: decimal('1.3'), shiftFollowing: false});
  assert.deepEqual(out.tracks[0].clips[0].target.duration, rational(60, 13));
});
test('ripple is explicit, and overlap fails atomically', () => {
  const d = one(), id = d.tracks[0].clips[0].id;
  const split = applyCommand(d, {type: 'split', clipId: id, at: rational(3), rightId: 'right'});
  const before = structuredClone(split);
  assert.throws(() => applyCommand(split, {type: 'speed', clipId: id, value: rational(1, 2), shiftFollowing: false}), /OVERLAP_POLICY_UNRESOLVED/);
  const shifted = applyCommand(split, {type: 'speed', clipId: id, value: rational(1, 2), shiftFollowing: true});
  assert.deepEqual(shifted.tracks[0].clips[1].target.start, rational(6));
  assert.deepEqual(split, before);
});
test('invalid commands and unknown timing do not mutate the input', () => {
  const d = one(), id = d.tracks[0].clips[0].id, before = structuredClone(d);
  for (const at of [rational(0), rational(6), rational(7)])
    assert.throws(() => applyCommand(d, {type: 'split', clipId: id, at, rightId: 'right'}));
  assert.throws(() => applyCommand(d, {type: 'split', clipId: id, at: rational(3), rightId: id}), /DUPLICATE_ID/);
  assert.throws(() => applyCommand(d, {type: 'speed', clipId: id, value: rational(0), shiftFollowing: true}));
  assert.deepEqual(d, before);
  const k = importJianying(readSnapshot('05-scale-keyframes.json')).document;
  assert.throws(() => applyCommand(k, {type: 'speed', clipId: k.tracks[0].clips[1].id, value: rational(2), shiftFollowing: false}), /TIMING_NOT_INTERPRETED/);
});
