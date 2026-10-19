import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {probeDisplayTransform} from '../packages/core/src/source-display.ts';
import {emptyDocument,validateDocument} from '../packages/core/src/document.ts';import type {Asset} from '../packages/core/src/document.ts';import {rational as r} from '../packages/core/src/time.ts';import {spatialEdgePolicy} from '../packages/core/src/transition-edge.ts';
import {probeAsset,probe,ffmpeg} from '../packages/media/src/probe.ts';import {render} from '../packages/media/src/render.ts';import {createPreviewPlan,previewFrame} from '../apps/editor/src/preview/plan.ts';import {Store} from '../apps/service/store.ts';
function fixture(asset:Asset){const doc=emptyDocument();doc.canvas={width:1280,height:720};doc.fps=r(30);doc.assets=[asset];doc.tracks[0].clips=['a','b'].map((id,i)=>({id,materialId:asset.id,source:{start:i?r(7,2):r(0),duration:r(2)},target:{start:r(i*2),duration:r(2)},speed:r(1),editableTiming:true}));doc.transitions=[{id:'plane',trackId:doc.tracks[0].id,outgoingClipId:'a',incomingClipId:'b',kind:'wipeLeft',alignment:'center',overlap:true,duration:r(1)}];return doc;}

test('only absent matrices plus finite zero rotation provide an identity marker, including zero-angle reflections',()=>{
 for(const stream of [{},{tags:{}},{tags:{rotate:'0'}},{tags:{rotate:-0}},{side_data_list:[{side_data_type:'other'}]}])assert.equal(probeDisplayTransform(stream),'identity');
 for(const stream of [null,[],{tags:{rotate:'90'}},{tags:{rotate:'garbage'}},{tags:{rotate:''}},{tags:{rotate:null}},{side_data_list:{}},{side_data_list:[{side_data_type:'Display Matrix',rotation:0,displaymatrix:'vertical reflection'}]}])assert.equal(probeDisplayTransform(stream),'unsupported');
 const doc=emptyDocument();doc.assets=[{id:'v',kind:'video',path:'/not-read',duration:r(1),verifiedDisplayTransform:'identity'}];validateDocument(doc);doc.assets[0].kind='image';validateDocument(doc);
 for(const kind of ['audio','text',undefined] as const){doc.assets[0].kind=kind;assert.throws(()=>validateDocument(doc),/INVALID_MEDIA_DISPLAY_TRANSFORM/);}
 doc.assets[0].kind='video';for(const invalid of ['unknown',true,1,null]){doc.assets[0].verifiedDisplayTransform=invalid as never;assert.throws(()=>validateDocument(doc),/INVALID_MEDIA_DISPLAY_TRANSFORM/);}
});

test('real rot90 and zero-angle reflected stream copies lose plane eligibility; forged identity is rejected by a fresh CPU probe',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-display-'));
 try{
  const source=path.join(dir,'source.mp4');execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=red:s=1280x720:r=30:d=6','-c:v','libx264','-preset','ultrafast','-crf','0','-pix_fmt','yuv420p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-color_range','tv','-y',source]);
  const normal=await probeAsset(source);assert.equal(normal.verifiedDisplayTransform,'identity');assert.equal(spatialEdgePolicy(fixture(normal),fixture(normal).transitions![0]),'bt709-cosited420-v1');
  for(const [name,option,value]of [['rot90','-display_rotation:v:0','90'],['vertical-reflection','-display_vflip:v:0','']] as const){
   const file=path.join(dir,name+'.mp4');execFileSync(ffmpeg(),['-v','error',option,...(value?[value]:[]),'-i',source,'-map','0:v:0','-c','copy','-y',file]);const metadata=await probe(file),stream=metadata.streams.find((s:any)=>s.codec_type==='video'),asset=await probeAsset(file);
   assert.equal(stream.width,1280);assert.equal(stream.height,720);assert.equal(asset.pixelFormat,'yuv420p');assert.equal(asset.verifiedDisplayTransform,'unsupported');if(name==='vertical-reflection')assert.equal(Math.abs(stream.side_data_list.find((s:any)=>s.side_data_type==='Display Matrix').rotation),0,'a reflected matrix may report rotation zero');
   const doc=fixture(asset);assert.equal(spatialEdgePolicy(doc,doc.transitions![0]),undefined);
   const gpu=createPreviewPlan(doc);assert(gpu.support.supported,'ordinary existing RGBA behavior is retained');assert.equal(previewFrame(gpu.plan!,r(2)).layers[0].transition!.edgePolicy,undefined);
   const forged=fixture({...asset,verifiedDisplayTransform:'identity'});assert.equal(spatialEdgePolicy(forged,forged.transitions![0]),'bt709-cosited420-v1');await assert.rejects(render(forged,path.join(dir,name+'-forged')),/SPATIAL_TRANSITION_SOURCE_ORIENTATION_UNSUPPORTED/);
   delete doc.transitions;doc.tracks[0].clips[0].vignette={version:'v1',intensity:.5};assert(createPreviewPlan(doc).support.reasons.some(reason=>reason.code==='VIGNETTE_SOURCE_ORIENTATION_UNSUPPORTED'));
  }
  const unknown=fixture({...normal});delete unknown.assets[0].verifiedDisplayTransform;const before=structuredClone(unknown);assert.equal(spatialEdgePolicy(unknown,unknown.transitions![0]),undefined);assert(createPreviewPlan(unknown).support.supported);assert.deepEqual(unknown,before,'old unknown metadata must not be upgraded by the plan');
  const smaller=path.join(dir,'small.mp4');execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=red:s=16x16:r=30:d=6','-c:v','libx264','-y',smaller]);const mismatched=fixture({...await probeAsset(smaller),width:1280,height:720});await assert.rejects(render(mismatched,path.join(dir,'size-forged')),/SPATIAL_TRANSITION_SOURCE_SIZE_MISMATCH/);
  const controller=new AbortController();controller.abort();await assert.rejects(render(fixture(normal),path.join(dir,'cancelled'),{signal:controller.signal}),/AbortError|aborted|JOB_CANCELLED/);
  const store=new Store(path.join(dir,'store'));await store.initialize();const legacy={...normal,path:'/existing/source.mp4',name:'original'};delete legacy.verifiedDisplayTransform;await store.addAsset(legacy);const refreshed=await store.addAsset(normal);assert.equal(refreshed.verifiedDisplayTransform,'identity');assert.equal(refreshed.path,legacy.path);assert.equal(refreshed.name,legacy.name);
  const reopened=new Store(store.root);await reopened.initialize();assert.equal(reopened.assets.get(normal.id)!.verifiedDisplayTransform,'identity');
  const displayOnly={...normal};delete displayOnly.pixelFormat;await assert.rejects(store.addAsset({...displayOnly,width:640}),/ASSET_DISPLAY_TRANSFORM_IDENTITY_MISMATCH/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
