import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {root, baselineRoot} from './fixtures.ts';

test('actual CLI replays all nine verified comparisons', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/replay-baseline.ts')], {cwd: os.tmpdir(), encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.length, 9); assert(report.checks.every((c: any) => c.passed));
  assert.equal(report.baselineVersion, '5.9.0');
});
test('tampered baseline and existing output are rejected without writes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yingxu-replay-'));
  try {
    fs.cpSync(path.join(baselineRoot, 'evidence/drafts'), path.join(tmp, 'evidence/drafts'), {recursive: true});
    fs.appendFileSync(path.join(tmp, 'evidence/drafts/01-single-video.json'), ' ');
    const cli = (args: string[]) => spawnSync(process.execPath, [path.join(root, 'scripts/replay-baseline.ts'), ...args], {encoding: 'utf8'});
    assert.equal(cli(['--baseline-root', tmp]).status, 2);
    const output = path.join(tmp, 'existing.json'); fs.writeFileSync(output, 'original');
    assert.equal(cli(['--output', output]).status, 2); assert.equal(fs.readFileSync(output, 'utf8'), 'original');
  } finally {fs.rmSync(tmp, {recursive: true, force: true});}
});
