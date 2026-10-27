import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {findMediaTool,mediaTool} from '../packages/media/src/tools.ts';

test('media tools resolve PATH and Finder fallback without assuming the author machine',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-tools-'));
 try{
  const first=path.join(root,'custom bin'),second=path.join(root,'brew');
  await fs.mkdir(first);await fs.mkdir(second);
  for(const dir of [first,second])await fs.writeFile(path.join(dir,'ffmpeg'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  const lookup=(env:NodeJS.ProcessEnv)=>findMediaTool('ffmpeg',{env,fallbackDirectories:[second]});
  assert.equal(lookup({PATH:first}),path.join(first,'ffmpeg'));
  assert.equal(lookup({PATH:'/usr/bin:/bin'}),path.join(second,'ffmpeg'));
  assert.equal(lookup({PATH:''}),path.join(second,'ffmpeg'));
  assert.equal(lookup({PATH:first,YINGXU_FFMPEG:path.join(root,'missing')}),undefined,'explicit invalid override cannot fall back');
  assert.equal(lookup({PATH:second,YINGXU_FFMPEG:path.join(first,'ffmpeg')}),path.join(first,'ffmpeg'));
  assert.equal(lookup({PATH:first,YINGXU_FFMPEG:'ffmpeg'}),path.join(first,'ffmpeg'));
  await fs.chmod(path.join(first,'ffmpeg'),0o644);
  assert.equal(lookup({PATH:first}),path.join(second,'ffmpeg'),'skip non-executable files');
  await fs.rm(path.join(second,'ffmpeg'));await fs.mkdir(path.join(second,'ffmpeg'));
  assert.equal(lookup({PATH:first}),undefined,'a directory is not an engine');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('media tool getter preserves an invalid explicit override for execution diagnostics',()=>{
 const previous=process.env.YINGXU_RUBBERBAND;
 try{process.env.YINGXU_RUBBERBAND='/missing/explicit rubberband';assert.equal(mediaTool('rubberband'),process.env.YINGXU_RUBBERBAND);}
 finally{if(previous===undefined)delete process.env.YINGXU_RUBBERBAND;else process.env.YINGXU_RUBBERBAND=previous;}
});
