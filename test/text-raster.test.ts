import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rasterText} from '../packages/media/src/text-raster.ts';
import {captionScript} from '../packages/media/src/captions.ts';
import {runProcess} from '../packages/media/src/process.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
import {renderGraph} from '../packages/media/src/graph.ts';
import {Store} from '../apps/service/store.ts';
import {TextRasters} from '../apps/service/text-raster.ts';
import {createPreviewPlan,previewFrame} from '../apps/editor/src/preview/plan.ts';

function doc(){const d=emptyDocument();d.canvas={width:320,height:180};d.assets.push({id:'txt',kind:'text',path:'',duration:rational(3600)});d.tracks[2].clips.push({id:'caption',materialId:'txt',source:{start:rational(0),duration:rational(2)},target:{start:rational(1),duration:rational(2)},speed:rational(1),editableTiming:true,transform:{...defaultTransform(),x:17,y:-13,scale:.85,rotation:12,opacity:.6},text:{content:'中文 alpha\n第二行 {安全} \\pos',font:'Source Han Sans SC Medium',color:'#f1b874',size:31,outline:1.3,shadow:1,lineHeight:42}});return d;}
async function raw(input:string,directory:string,name:string){const target=path.join(directory,name);await runProcess(ffmpeg(),['-v','error','-y','-i',input,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo',target]);return fs.readFile(target);}

test('libass static PNG retains Chinese, multiline, transformed layout and straight alpha against export compositing',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-raster-'));
 try{const d=doc(),layer=renderGraph(d).layers[0],png=await rasterText(layer,d.canvas,root),pixels=await raw(png.path,root,'raster.rgba');
  assert.equal(pixels.length,320*180*4);let partial=0,visible=0,transparent=0;for(let i=3;i<pixels.length;i+=4){if(pixels[i]===0)transparent++;else visible++;if(pixels[i]>0&&pixels[i]<255)partial++;}
  assert(visible>1000&&transparent>45000&&partial>500,'caption must preserve transparent margins and antialiased/opacity alpha');
  const shifted={...layer,clip:{...layer.clip,target:{start:rational(0),duration:rational(1)}}};await fs.writeFile(path.join(root,'direct.ass'),captionScript([shifted],d.canvas,d.fps));
  // The lavfi chain is explicit RGBA before subtitles, with no YUV encode/decode.
  const originalBlack=await fs.readFile(path.join(root,'black.rgba')),originalWhite=await fs.readFile(path.join(root,'white.rgba'));
  assert.deepEqual([...originalBlack.subarray(0,4)],[0,0,0,255]);assert.deepEqual([...originalWhite.subarray(0,4)],[255,255,255,255]);
  for(const background of ['0x2577b9','0xf5e0a3','0x190d24']){
   await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i',`color=c=${background}:s=320x180:r=30,format=rgba`,'-vf','subtitles=filename=direct.ass:fontsdir=fonts','-frames:v','1','-pix_fmt','rgba','-f','rawvideo','direct.rgba'],{cwd:root});
   const direct=await fs.readFile(path.join(root,'direct.rgba'));let max=0,total=0,count=0;for(let i=0;i<pixels.length;i+=4){for(let c=0;c<3;c++){const alpha=pixels[i+3]/255,predicted=Math.round(pixels[i+c]*alpha+direct[c]*(1-alpha)),delta=Math.abs(predicted-direct[i+c]);max=Math.max(max,delta);total+=delta;count++;}}
   assert(max<=3,`straight-alpha shader blend against ${background} differs from direct libass by ${max}`);assert(total/count<.08);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('text textures are revision bound, content keyed, cached and unknown or animated text is rejected',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-service-')),store=new Store(root);await store.initialize();const state=await store.create(doc()),rasters=new TextRasters(store,{engine:'test-font-code-identity'});
 try{const first=await rasters.request(state.id,{revision:state.revision,clipId:'caption'}),file=await rasters.file(first.key),before=(await fs.stat(file)).mtimeMs;
  const second=await rasters.request(state.id,{revision:state.revision,clipId:'caption'});assert.deepEqual(first,second);assert.equal((await fs.stat(file)).mtimeMs,before);
  await assert.rejects(rasters.request(state.id,{revision:state.revision+1,clipId:'caption'}),/REVISION_CONFLICT/);
  await assert.rejects(rasters.request(state.id,{revision:state.revision,clipId:'absent'}),/TEXT_RASTER_CLIP_REQUIRED/);
  await assert.rejects(rasters.file('../bad'),/INVALID_TEXT_TEXTURE_KEY/);
  const abort=new AbortController();abort.abort();await assert.rejects(rasters.request(state.id,{revision:state.revision,clipId:'caption'},abort.signal),/Aborted/);
  const changed=doc();changed.tracks[2].clips[0].text!.content='新文字';const state2=await store.create(changed),next=await rasters.request(state2.id,{revision:state2.revision,clipId:'caption'});assert.notEqual(next.key,first.key);
  await fs.appendFile(file,'corrupt');await assert.rejects(rasters.file(first.key),/TEXT_TEXTURE_CACHE_INVALID/);
  store.get(state.id).diagnostics=[{code:'UNKNOWN_EFFECT'}];await assert.rejects(rasters.request(state.id,{revision:state.revision,clipId:'caption'}),/UNSUPPORTED_DRAFT_EFFECTS/);
 }finally{await rasters.shutdown();await fs.rm(root,{recursive:true,force:true});}
});

test('GPU text planning enables only connected static rasters, respects cue frame edges and uses bounded exact animation frames',()=>{
 const d=doc();assert.equal(createPreviewPlan(d).support.supported,false);const result=createPreviewPlan(d,{texturesAvailable:true});assert.equal(result.support.supported,true);
 assert.equal(previewFrame(result.plan!,rational(29,30)).layers.length,0);assert.equal(previewFrame(result.plan!,rational(1)).layers[0].clip.id,'caption');assert.equal(previewFrame(result.plan!,rational(3)).layers.length,0);
 d.tracks[2].clips[0].animations=[{property:'opacity',points:[{id:'a',time:rational(0),value:0,interpolation:'linear'},{id:'b',time:rational(2),value:1,interpolation:'linear'}]}];assert.equal(createPreviewPlan(d,{texturesAvailable:true}).support.supported,true);
});

test('text demand queue is bounded and old disk entries are evicted without pre-rendering subtitles',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-bounds-')),store=new Store(root);await store.initialize();const state=await store.create(doc()),rasters=new TextRasters(store,{engine:'bounded'});
 try{await assert.rejects(fs.access(path.join(root,'text-renders')),/ENOENT/);
  const controller=new AbortController();controller.abort();const requests=Array.from({length:33},()=>rasters.request(state.id,{revision:state.revision,clipId:'caption'},controller.signal));
  const results=await Promise.allSettled(requests);assert.equal(results.filter(r=>r.status==='rejected'&&/QUEUE_LIMIT/.test(r.reason.message)).length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.name==='AbortError').length,32);
  const cache=path.join(root,'text-renders');await fs.mkdir(cache);for(let i=0;i<513;i++){const key=i.toString(16).padStart(64,'0');await fs.writeFile(path.join(cache,key+'.png'),'old');await fs.writeFile(path.join(cache,key+'.json'),'{}');}
  const texture=await rasters.request(state.id,{revision:state.revision,clipId:'caption'});assert.equal((await fs.readdir(cache)).filter(f=>f.endsWith('.png')).length,512);assert(await rasters.file(texture.key));
 }finally{await rasters.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
