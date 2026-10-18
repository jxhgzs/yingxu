import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const baseline = JSON.parse(fs.readFileSync(path.join(root, 'docs/parity/baseline.json'), 'utf8'));
export const baselineRoot = path.resolve(root, baseline.baselineRoot);
export function readSnapshot(name: string): any {
  if (!baseline.snapshots.includes(name)) throw Error('UNREGISTERED_SNAPSHOT');
  return JSON.parse(fs.readFileSync(path.resolve(root, baseline.snapshotDirectory, name), 'utf8'));
}
