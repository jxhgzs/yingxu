import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('doctor reports configured missing tools and exits nonzero without silently using Homebrew',()=>{
 const result=spawnSync(process.execPath,['scripts/doctor.ts'],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',env:{...process.env,YINGXU_FFMPEG:'/missing/ffmpeg',YINGXU_FFPROBE:'/missing/ffprobe',YINGXU_RUBBERBAND:'/missing/rubberband'}});
 assert.equal(result.status,1);const output=result.stdout+result.stderr;
 for(const name of ['ffmpeg','ffprobe','rubberband'])assert.match(output,new RegExp(`FAIL ${name}:`));
 assert.match(output,/brew install ffmpeg rubberband/);
 assert.doesNotMatch(output,/ERR_MODULE_NOT_FOUND|Cannot find module/);
});
