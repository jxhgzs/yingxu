import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {importJianying} from '../packages/jianying/src/import.ts';
import {projectTiming} from '../packages/core/src/document.ts';
import {createSession} from '../packages/core/src/session.ts';
import {rational} from '../packages/core/src/time.ts';

const repo = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'docs/parity/baseline.json'), 'utf8'));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let phase = 'input';
try {
  const args = process.argv.slice(2); let output: string | undefined;
  let baselineRoot = path.resolve(repo, manifest.baselineRoot);
  for (let i = 0; i < args.length; i++) {
    if (!['--output', '--baseline-root'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error('INVALID_ARGUMENT');
    if (args[i] === '--output') output = path.resolve(args[++i]); else baselineRoot = path.resolve(args[++i]);
  }
  if (output && fs.existsSync(output)) throw Error('OUTPUT_EXISTS');
  const files = manifest.files.filter((f: {path: string}) => f.path.startsWith('evidence/drafts/'));
  const inputs = new Map<string, ReturnType<typeof importJianying>>();
  const verify = () => {
    for (const file of files) {
      if (hash(fs.readFileSync(path.join(baselineRoot, file.path))) !== file.sha256) throw Error(`BASELINE_HASH_MISMATCH: ${file.path}`);
    }
  };
  verify();
  for (const file of files) {
    const text = fs.readFileSync(path.join(baselineRoot, file.path), 'utf8');
    inputs.set(path.basename(file.path), importJianying(JSON.parse(text), text));
  }
  phase = 'comparison';
  const get = (name: string) => { const result = inputs.get(name); assert(result, name); return result; };
  const checks: {name: string; passed: boolean}[] = [];
  const check = (name: string, f: () => void) => { f(); checks.push({name, passed: true}); };
  check('baseline-hashes', () => assert.equal(inputs.size, 6));
  check('empty-draft', () => assert.equal(get('00-empty.json').document.tracks.flatMap(t => t.clips).length, 0));
  const single = get('01-single-video.json').document;
  check('single-six-seconds', () => assert.deepEqual(single.tracks[0].clips[0].target.duration, rational(6)));
  const session = createSession(single);
  const split = session.execute(0, {type: 'split', clipId: single.tracks[0].clips[0].id, at: rational(3), rightId: 'replay-right'});
  check('split-at-three', () => assert.deepEqual(projectTiming(split.document), projectTiming(get('02-split-at-3s.json').document)));
  const fast = session.execute(1, {type: 'speed', clipId: 'replay-right', value: rational(2), shiftFollowing: false});
  check('second-clip-two-times', () => assert.deepEqual(projectTiming(fast.document), projectTiming(get('03-second-clip-2x.json').document)));
  const undone = session.undo(2);
  check('undo-equals-split', () => { assert.deepEqual(undone.document, split.document); assert.deepEqual(projectTiming(undone.document), projectTiming(get('04-undo-speed.json').document)); });
  check('redo-equals-speed', () => assert.deepEqual(session.redo(3).document, fast.document));
  const keyframes = get('05-scale-keyframes.json');
  check('keyframes-preserved-uninterpreted', () => {
    assert.equal(keyframes.document.tracks[0].clips[1].editableTiming, false);
    assert(keyframes.diagnostics.some(d => d.code === 'KEYFRAME_CLOCK_UNRESOLVED'));
    assert.deepEqual(keyframes.provenance.raw, JSON.parse(fs.readFileSync(path.join(baselineRoot, 'evidence/drafts/05-scale-keyframes.json'), 'utf8')));
  });
  check('input-files-unchanged', verify);
  const report = {baselineVersion: '5.9.0', checks, diagnostics: keyframes.diagnostics,
    limitations: ['Timing semantics only; no visual, audio, curve-speed, keyframe rendering or performance parity claim.']};
  const text = JSON.stringify(report, null, 2) + '\n';
  if (output) { fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, text, {flag: 'wx'}); }
  process.stdout.write(text);
} catch (error) {
  process.stderr.write(JSON.stringify({error: error instanceof Error ? error.message : String(error), phase}) + '\n');
  process.exitCode = phase === 'input' ? 2 : 3;
}
