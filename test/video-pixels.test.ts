import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {isOpaqueVideoPixelFormat,validVideoPixelFormat} from '../packages/core/src/video-pixels.ts';
import {emptyDocument,validateDocument} from '../packages/core/src/document.ts';
import {rational as r} from '../packages/core/src/time.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {Store} from '../apps/service/store.ts';

test('finite opaque pixel-format policy never guesses missing, alpha or unrecognized formats',()=>{
 for(const format of ['yuv420p','yuv444p','nv12','rgb24'])assert(isOpaqueVideoPixelFormat(format));
 for(const format of [undefined,'unknown','rgba','argb','yuva444p','gbrap','unlisted'])assert(!isOpaqueVideoPixelFormat(format));
 const doc=emptyDocument();doc.assets=[{id:'v',kind:'video',path:'/not-read.mov',duration:r(1),pixelFormat:'argb'}];validateDocument(doc);
 for(const format of ['',null,3,'YUV420P','x'.repeat(41),'yuv420p;null']){doc.assets[0].pixelFormat=format as never;assert.throws(()=>validateDocument(doc),/INVALID_MEDIA_PIXEL_FORMAT/);}
 assert(validVideoPixelFormat('yuv420p10le'));assert(!isOpaqueVideoPixelFormat('yuv420p10le'),'unmeasured formats stay outside this finite version');
});

test('probe exposes actual alpha format and same-identity registration refresh preserves the old path/name/CFR',{timeout:30000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-pixels-'));
 try{
  const source=path.join(dir,'alpha.mov');execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=red@0.5:s=16x16:r=30:d=1,format=argb','-c:v','qtrle','-y',source]);
  const asset=await probeAsset(source);assert.equal(asset.pixelFormat,'argb');assert(!isOpaqueVideoPixelFormat(asset.pixelFormat));
  const store=new Store(path.join(dir,'store'));await store.initialize();const legacy={...asset,path:'/old/immutable.mov',name:'old name',frameTiming:'cfr30' as const};delete legacy.pixelFormat;
  const first=await store.addAsset(legacy,{verifiedFrameTiming:'cfr30'});assert.equal(first.pixelFormat,undefined);
  const refreshed=await store.addAsset({...asset,name:'new name'});assert.equal(refreshed.pixelFormat,'argb');assert.equal(refreshed.path,legacy.path);assert.equal(refreshed.name,'old name');assert.equal(refreshed.frameTiming,'cfr30');
  const reloaded=new Store(store.root);await reloaded.initialize();assert.equal(reloaded.assets.get(asset.id)!.pixelFormat,'argb');
  await assert.rejects(store.addAsset({...asset,sha256:'a'.repeat(64)}),/ASSET_PIXEL_FORMAT_IDENTITY_MISMATCH/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
