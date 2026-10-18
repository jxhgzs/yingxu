import test from 'node:test';
import assert from 'node:assert/strict';
import {readSnapshot, baseline, baselineRoot} from './fixtures.ts';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {importJianying} from '../packages/jianying/src/import.ts';
import {projectTiming} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';

test('all six registered snapshots import without writes', () => {
  for (const name of baseline.snapshots) {
    const raw = readSnapshot(name), before = structuredClone(raw);
    assert.deepEqual(importJianying(raw).provenance.raw, before);
    assert.deepEqual(raw, before);
  }
  for (const f of baseline.files.filter((f: any) => f.path.includes('/drafts/'))) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(baselineRoot, f.path))).digest('hex'), f.sha256);
  }
});
test('speed retains source range while shortening target', () => {
  const result = importJianying(readSnapshot('03-second-clip-2x.json'));
  const clips = result.document.tracks[0].clips;
  assert.deepEqual(clips[1].source, {start: rational(3), duration: rational(3)});
  assert.deepEqual(clips[1].target, {start: rational(3), duration: rational(3, 2)});
  assert.deepEqual(clips[1].speed, rational(2));
  assert.deepEqual(projectTiming(importJianying(readSnapshot('02-split-at-3s.json')).document),
    projectTiming(importJianying(readSnapshot('04-undo-speed.json')).document));
});
test('unknown fields and keyframe clocks remain intact and timing is read only', () => {
  const raw = readSnapshot('05-scale-keyframes.json'); raw.customOpaque = {version: 25, arbitrary: ['保留', 3]};
  const result = importJianying(raw);
  assert.deepEqual(result.provenance.raw, raw);
  assert(result.diagnostics.some(d => d.code === 'KEYFRAME_CLOCK_UNRESOLVED'));
  assert.equal(result.document.tracks[0].clips[1].editableTiming, false);
  raw.customOpaque.arbitrary.push('mutation');
  assert.notDeepEqual(result.provenance.raw, raw);
});
test('reject invalid core structures instead of returning a partial project', () => {
  const edits = [
    (d: any) => {d.tracks[0].type = 'text';},
    (d: any) => {d.tracks[0].segments[0].speed = 0;},
    (d: any) => {d.tracks[0].segments[0].source_timerange.duration = -1;},
    (d: any) => {d.tracks[0].segments[0].material_id = 'missing';},
    (d: any) => {d.tracks[0].segments.push(structuredClone(d.tracks[0].segments[0]));},
    (d: any) => {d.fps = Infinity;},
    (d: any) => {d.tracks[0].segments[0].source_timerange.start = 5000000;},
  ];
  for (const edit of edits) { const d = readSnapshot('01-single-video.json'); edit(d); assert.throws(() => importJianying(d)); }
});
