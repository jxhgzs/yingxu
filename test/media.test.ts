import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {baselineRoot} from './fixtures.ts';
import {probeAsset, probe} from '../packages/media/src/probe.ts';
import {render} from '../packages/media/src/render.ts';
import {renderGraph} from '../packages/media/src/graph.ts';
import {emptyDocument, defaultTransform} from '../packages/core/src/document.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {rational} from '../packages/core/src/time.ts';

test('native export renders split/speed to a real 135-frame file, plus preview and text', {timeout: 120000}, async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yingxu-native-'));
  try {
    const a = await probeAsset(path.join(baselineRoot, 'fixtures/timeline-probe.mp4'));
    assert.equal(a.width, 640); assert.equal(a.hasAudio, true); assert.deepEqual(a.fps, rational(30));
    let d = emptyDocument(); d.canvas = {width: 1280, height: 720}; d.assets.push(a);
    d.tracks[0].clips.push({id: 'clip', materialId: a.id, source: {start: rational(0), duration: rational(6)},
      target: {start: rational(0), duration: rational(6)}, speed: rational(1), editableTiming: true});
    d = applyCommand(d, {type: 'split', clipId: 'clip', at: rational(3), rightId: 'right'});
    d = applyCommand(d, {type: 'speed', clipId: 'right', value: rational(2), shiftFollowing: false});
    const file = await render(d, path.join(tmp, 'export'));
    assert.equal(file.frameCount, 135); assert.equal(file.duration, 4.5);
    const p = await probe(file.path); assert.equal(Number(p.streams[0].nb_frames), 135);
    assert(p.streams.some((s: any) => s.codec_type === 'audio'));
    d.assets.push({id: 'text', kind: 'text', path: '', duration: rational(3600)});
    d.tracks[2].clips.push({id: 'caption', materialId: 'text', source: {start: rational(0), duration: rational(2)},
      target: {start: rational(1), duration: rational(2)}, speed: rational(1), editableTiming: true,
      transform: {...defaultTransform(), y: 200}, text: {content: '映序测试 {安全文字}', size: 54, color: '#ffffff', font: 'PingFang SC'}});
    const preview = await render(d, path.join(tmp, 'preview'), {preview: true});
    assert.equal(preview.width, 640); assert.equal(preview.frameCount, 135);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(render(d, path.join(tmp, 'cancelled'), {signal: abort.signal}), /JOB_CANCELLED/);
    d.tracks[0].clips[0].editableTiming = false;
    assert.throws(() => renderGraph(d), /TIMING_NOT_INTERPRETED/);
  } finally {await fs.rm(tmp, {recursive: true, force: true});}
});
