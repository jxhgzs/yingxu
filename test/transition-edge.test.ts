import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {importJianying} from '../packages/jianying/src/import.ts';
import {defaultTransform} from '../packages/core/src/document.ts';
import type {Document} from '../packages/core/src/document.ts';
import {rational as r} from '../packages/core/src/time.ts';
import {spatialEdgePolicy,spatialReconstruction,SPATIAL_EDGE_POLICY,spatialOutgoing,spatialChromaAnchor,spatialPlaneMask,rgbTo709,yuv709ToRgb,reconstructSpatialEdge} from '../packages/core/src/transition-edge.ts';
import {createPreviewPlan,previewFrame} from '../apps/editor/src/preview/plan.ts';
const fixture=()=>{const doc=importJianying(JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-rea-transitions-v8/18-circle-canvas720-native.json',import.meta.url),'utf8'))).document;for(const asset of doc.assets){asset.pixelFormat='yuv444p';asset.verifiedDisplayTransform='identity';}return doc;};

test('plane edge policy admits observed opaque pair and refuses unobserved interactions without mutating documents',()=>{
 const doc=fixture(),before=structuredClone(doc),transition=doc.transitions![0];
 assert.equal(spatialEdgePolicy(doc,transition),SPATIAL_EDGE_POLICY);assert.deepEqual(doc,before);
 const pair=previewFrame(createPreviewPlan(doc).plan!,r(2)).layers[0].transition!;assert.equal(pair.edgePolicy,SPATIAL_EDGE_POLICY);
 const invalid:((d:Document)=>void)[]=[
  d=>{d.tracks.find(t=>t.clips.length)!.clips[0].transform={...defaultTransform(),opacity:.5};},
  d=>{d.tracks.find(t=>t.clips.length)!.clips[0].transform={...defaultTransform(),x:1};},
  d=>{d.tracks.find(t=>t.clips.length)!.clips[0].colorAdjustments={version:'combine-adjust-v2',contrast:.1};},
  d=>{Object.assign(d.tracks.find(t=>t.clips.length)!.clips[0],{vignette:{version:'v1',intensity:.1}});},
  d=>{d.assets.find(a=>a.kind==='video')!.width=640;},
  d=>{d.assets.find(a=>a.kind==='video')!.colorSpace={matrix:'smpte170m'};},
  d=>{d.tracks.find(t=>t.clips.length)!.clips.push({...structuredClone(d.tracks.find(t=>t.clips.length)!.clips[0]),id:'extra'});},
  d=>{d.transitions!.push({...structuredClone(d.transitions![0]),id:'extra'});},
  d=>{d.fps=r(24);},
  d=>{delete d.assets[0].verifiedDisplayTransform;},
  d=>{d.assets[0].verifiedDisplayTransform='unsupported';},
  d=>{delete d.assets[0].pixelFormat;},
  d=>{d.assets[0].pixelFormat='yuva444p';},
  d=>{d.assets[0].pixelFormat='unknown';},
 ];
 for(const mutate of invalid){const changed=structuredClone(doc);mutate(changed);assert.equal(spatialEdgePolicy(changed,changed.transitions![0]),undefined);}
});

test('shared plane masks use full-resolution cosited centres; equality remains outgoing',()=>{
 assert.deepEqual(spatialChromaAnchor(597.5,201.5),[596.5,200.5]);
 assert(spatialOutgoing('wipeLeft',640,120,1280,720,.5));assert(!spatialOutgoing('wipeLeft',640.5,120,1280,720,.5));
 // At frame61, x597 is B luma but the block anchor596.5 is A chroma.
 assert(!spatialOutgoing('wipeLeft',597.5,.5,1280,720,16/30));assert(spatialOutgoing('wipeLeft',596.5,.5,1280,720,16/30));
 const radius=Math.hypot(1280,720)/4;assert(spatialOutgoing('circleOpen',640+radius,360,1280,720,.5));
 assert.equal(spatialPlaneMask('wipeLeft',1280,720,'P',0),'lte(1*X+0.5,1280*(1-(P)))');
 assert.equal(spatialPlaneMask('circleOpen',1280,720,'P',2),'gte(hypot(2*X+0.5-640,2*Y+0.5-360),(P)*hypot(1280,720)/2)');
});

test('709 edge reconstruction combines independently selected luma and chroma, preserving the shared matrix',()=>{
 for(const rgb of [[0,0,0],[1,1,1],[1,0,0],[0,1,0],[0,0,1],[.3,.5,.7]] as [number,number,number][]){
  const roundtrip=yuv709ToRgb(rgbTo709(rgb));roundtrip.forEach((v,i)=>assert(Math.abs(v-rgb[i])<1e-12));
 }
 const actual=reconstructSpatialEdge([0,0,1],[1,0,0]);assert(actual[0]>.8);assert.equal(actual[1],0);assert.equal(actual[2],0);
 assert.deepEqual(reconstructSpatialEdge([1,1,1],[0,0,0]),[1,1,1]);
});

test('actual plane export retains B luma with A chroma at the observed cross-side pixel, including range exports',{timeout:120000},async()=>{
 const {execFileSync}=await import('node:child_process'),fsp=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {render}=await import('../packages/media/src/render.ts'),{probeAsset,ffmpeg}=await import('../packages/media/src/probe.ts');
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'yingxu-edge-'));
 try{
  const source=path.join(dir,'red-blue.mp4');execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=red:s=1280x720:r=30:d=3','-f','lavfi','-i','color=blue:s=1280x720:r=30:d=3','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0,format=yuv444p','-c:v','libx264','-crf','0','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-y',source]);
  const doc=fixture(),asset=await probeAsset(source),originalAssets=doc.assets;doc.assets=originalAssets.map(a=>({...asset,id:a.id}));doc.transitions![0].kind='wipeLeft';assert.equal(spatialEdgePolicy(doc,doc.transitions![0]),SPATIAL_EDGE_POLICY);
  const output=await render(doc,path.join(dir,'full'));
  const decode=(file:string,frames:number[])=>execFileSync(ffmpeg(),['-v','error','-i',file,'-vf',`select='${frames.map(n=>`eq(n,${n})`).join('+')}'`,'-fps_mode','passthrough','-pix_fmt','yuv420p','-f','rawvideo','-'],{maxBuffer:12*1024*1024});
  const bytes=1280*720*3/2,raw=decode(output.path,[0,61,119]);assert.equal(raw.length,3*bytes);
  const offsets=[200*1280+597,1280*720+100*640+298,1280*720+640*360+100*640+298];
  offsets.forEach((offset,plane)=>{const expected=raw[(plane===0?2:0)*bytes+offset],other=raw[(plane===0?0:2)*bytes+offset],error=Math.abs(raw[bytes+offset]-expected);assert(error<=10&&error*8<Math.abs(raw[bytes+offset]-other),`plane${plane}: ${raw[bytes+offset]} must retain ${plane===0?'B luma':'A chroma'} near ${expected}, not ${other}; H264 CRF18 is lossy`);});
  const settings=JSON.parse(await fsp.readFile(path.join(dir,'full','transition-edges.json'),'utf8'));assert.deepEqual(settings.admitted,[doc.transitions![0].id]);
  // The YUV overlay uses the original sequence clock before output trimming.
  const ranged=await render(doc,path.join(dir,'range'),{exportSettings:{range:{start:r(2),duration:r(1,15)}}});
  const rangeRaw=decode(ranged.path,[1]);assert.equal(rangeRaw.length,bytes);offsets.forEach(offset=>assert(Math.abs(rangeRaw[offset]-raw[bytes+offset])<=4));
 }finally{await fsp.rm(dir,{recursive:true,force:true});}
});


test('new centered reconstruction stays within the probed444 cohort; existing420 policy remains unchanged',()=>{
 const doc=fixture();assert.equal(spatialReconstruction(doc,doc.transitions![0]),'centered-bilinear444-v2');const plan=createPreviewPlan(doc).plan!;assert.equal(previewFrame(plan,r(2)).layers[0].transition!.edgeReconstruction,'centered-bilinear444-v2');
 for(const asset of doc.assets)asset.pixelFormat='yuv420p';assert.equal(spatialEdgePolicy(doc,doc.transitions![0]),SPATIAL_EDGE_POLICY);assert.equal(spatialReconstruction(doc,doc.transitions![0]),undefined);
 delete doc.assets[0].verifiedDisplayTransform;assert.equal(spatialReconstruction(doc,doc.transitions![0]),undefined);
});
