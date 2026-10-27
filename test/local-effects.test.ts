import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {LocalEffects} from '../apps/service/local-effects.ts';import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';import {runProcess} from '../packages/media/src/process.ts';
import {textAnimationGlyphScales,validateTextAnimations} from '../packages/core/src/text-animation.ts';import {rational as r} from '../packages/core/src/time.ts';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';import {renderGraph} from '../packages/media/src/graph.ts';import {render} from '../packages/media/src/render.ts';import {rasterText} from '../packages/media/src/text-raster.ts';import {Store} from '../apps/service/store.ts';import {TextRasters} from '../apps/service/text-raster.ts';
import {createPreviewPlan} from '../apps/editor/src/preview/plan.ts';
const animation={phase:'loop' as const,kind:'alternate-scale' as const,duration:r(11,8)};
function document(){const d=emptyDocument();d.canvas={width:320,height:180};d.assets=[{id:'text',path:'',kind:'text',duration:r(4)}];d.tracks[2].clips=[{id:'c',materialId:'text',source:{start:r(0),duration:r(3)},target:{start:r(0),duration:r(3)},speed:r(1),editableTiming:true,transform:{...defaultTransform(),rotation:13},text:{content:'AB C中文\nD EFG',font:'Source Han Sans SC Medium',size:32,color:'#ffc080',outline:1,shadow:1},textAnimations:[animation]}];return d;}
test('paid pulse tracks reproduce independent key times, complement, plateau and exact rational cycles',()=>{
 validateTextAnimations([animation],r(3));for(const [time,expected]of[[r(0),1],[r(3,16),1.4],[r(5,16),1.4],[r(13,16),.6],[r(17,16),.6],[r(11,8),1]]as const){const pose=textAnimationGlyphScales([animation],time,r(3),r(30))!;assert(Math.abs(pose[0]-expected)<1e-10);assert(Math.abs(pose[0]+pose[1]-2)<1e-12);}
 for(let n=0;n<165;n++){const a=textAnimationGlyphScales([animation],r(n,60),r(3),r(30))!;assert(a.every(v=>v>=.6-1e-10&&v<=1.4+1e-10));}
 const combo=[{phase:'in' as const,kind:'fade' as const,duration:r(3,10)},animation,{phase:'out' as const,kind:'fade' as const,duration:r(2,5)}];assert.equal(textAnimationGlyphScales(combo,r(3,10),r(3),r(30)),undefined);assert.deepEqual(textAnimationGlyphScales(combo,r(14,5),r(3),r(30)),textAnimationGlyphScales(combo,r(77,30),r(3),r(30)));
 assert.throws(()=>validateTextAnimations([{...animation,phase:'in'}],r(3)),/KIND_UNVERIFIED/);
});
test('pulse frame cache includes glyph scale and matches scalar rendering through rotation and multiline',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pulse-cache-')),store=new Store(root);await store.initialize();const d=document(),state=await store.create(d),rasters=new TextRasters(store,{engine:'pulse-test'});
 try{const frames=[0,6,8,25,27],batch=await rasters.batch(state.id,{revision:0,clipId:'c',frames});assert.notEqual(batch.textures[0].key,batch.textures[1].key);assert.equal(batch.textures[1].key,batch.textures[2].key);assert.equal(batch.textures[3].key,batch.textures[4].key);
  for(let i=0;i<frames.length;i++){const scalar=await rasterText(renderGraph(d).layers[0],d.canvas,path.join(root,'s'+i),{mode:'frame',frame:frames[i],fps:d.fps});assert.deepEqual(await fs.readFile(await rasters.file(batch.textures[i].key)),await fs.readFile(scalar.path));}
  const result=await render(d,path.join(root,'export'));assert.equal(result.frameCount,90);const plan=createPreviewPlan(d,{texturesAvailable:true});assert.equal(plan.support.supported,true);
 }finally{await rasters.shutdown();await fs.rm(root,{recursive:true,force:true});}
});
test('catalog disables unreviewed/missing/unsafe resources and never executes Lua',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'local-effects-'));try{
  const cache=path.join(root,'cache'),dir=path.join(cache,'12453543','unknown');await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'config.json'),'{}');await fs.writeFile(path.join(dir,'evil.lua'),'os.execute("false")');
  const unknown=path.join(cache,'999','x');await fs.mkdir(unknown,{recursive:true});await fs.writeFile(path.join(unknown,'config.json'),'{}');
  const escape=path.join(cache,'888','x');await fs.mkdir(escape,{recursive:true});await fs.symlink(path.join(unknown,'config.json'),path.join(escape,'config.json'));
  const library=new LocalEffects(root,async()=>{throw Error('MUST_NOT_REGISTER');},[cache,path.join(root,'absent')]);const catalog=await library.scan();assert.equal(catalog.missingRoots,1);assert.equal(catalog.entries.length,2);assert(catalog.entries.every(e=>!e.available));assert.equal(catalog.entries.find(e=>e.resourceId==='12453543')!.paid,'observed-paid');await assert.rejects(library.import(catalog.entries[0].key),/UNAVAILABLE/);await assert.rejects(library.import('../x'),/NOT_FOUND/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
// Public regression suite uses generated fixtures above. Native cached pixels
// remain ignored local evidence and are tested by scripts/qa-local-effects.ts.
