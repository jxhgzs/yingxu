import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import type {Document,Transition} from '../packages/core/src/document.ts';
import {emptyDocument,validateDocument} from '../packages/core/src/document.ts';
import {rational as r} from '../packages/core/src/time.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {isKnownTransitionMaterial} from '../packages/jianying/src/transitions.ts';
import {importJianying} from '../packages/jianying/src/import.ts';
import {createPreviewPlan,previewFrame,transitionWeights} from '../apps/editor/src/preview/plan.ts';
import {buildTransitionCandidate} from '../apps/editor/src/transition-candidate.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {render} from '../packages/media/src/render.ts';
const read=(file:string)=>JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-rea-transitions-v8/'+file,import.meta.url),'utf8'));
function fixture(kind:Transition['kind']):Document{
 const doc=emptyDocument();doc.canvas={width:1280,height:720};doc.fps=r(30);doc.assets=[{id:'asset',kind:'video',path:'/not-read.mp4',duration:r(6),width:1280,height:720,fps:r(30)}];
 doc.tracks[0].clips=['a','b'].map((id,i)=>({id,materialId:'asset',source:{start:i?r(7,2):r(0),duration:r(2)},target:{start:r(i*2),duration:r(2)},speed:r(1),editableTiming:true}));
 doc.transitions=[{id:'spatial',trackId:doc.tracks[0].id,outgoingClipId:'a',incomingClipId:'b',kind,alignment:'center',overlap:true,duration:r(1)}];return doc;
}

test('spatial resources require exact true-mode identity; the actual false-mode UI effect stays diagnosed',()=>{
 for(const [file,kind]of [['16-circle-true-native.json','circleOpen'],['17b-wipe-true-native.json','wipeLeft']] as const){
  const raw=read(file),material=raw.materials.transitions[0];assert.equal(isKnownTransitionMaterial(material),true);assert.equal(isKnownTransitionMaterial({...material,is_overlap:false}),false);
  assert(importJianying(raw).diagnostics.some(d=>d.code==='SPATIAL_TRANSITION_GEOMETRY_UNVERIFIED'),'640x360 source is outside the independent same-resolution gate');
  const admitted=read(kind==='circleOpen'?'18-circle-canvas720-native.json':'19-wipe-canvas720-native.json');const result=importJianying(admitted);assert.deepEqual(result.diagnostics,[]);assert.equal(result.document.transitions![0].kind,kind);assert.deepEqual(result.document.canvas,{width:1280,height:720});
 }
 const actualFalse=importJianying(read('15-wipe-fresh-native.json'));assert.equal(actualFalse.document.transitions,undefined);assert(actualFalse.diagnostics.some(d=>d.code==='TRANSITION_UNSUPPORTED'));
});

test('spatial gates reject unverified geometry, fps and speed while shared candidates preserve source handles',()=>{
 for(const kind of ['wipeLeft','circleOpen'] as const){
  const doc=fixture(kind),before=structuredClone(doc);validateDocument(doc);doc.transitions=[];
  const candidate=buildTransitionCandidate(doc,doc.tracks[0].id,'a',kind);assert.ok(candidate.transition,candidate.reason);assert.equal(candidate.transition.overlap,true);assert.deepEqual(candidate.transition.duration,r(1,2));
  const plan=createPreviewPlan(before);assert(plan.support.supported);assert.equal(plan.support.maxConcurrentMedia,2);const frame=previewFrame(plan.plan!,r(2));assert.equal(frame.layers[0].transition?.kind,kind);assert.equal(frame.media.length,2);assert.deepEqual(transitionWeights(kind,.5),[1,1,0]);
  const changed=applyCommand(before,{type:'transition.update',transitionId:'spatial',changes:{kind:'dipToWhite'}});assert.equal(changed.transitions![0].overlap,false);
  for(const mutate of [(d:Document)=>{d.canvas={width:640,height:360};},(d:Document)=>{d.fps=r(24);},(d:Document)=>{d.tracks[0].clips[0].source.duration=r(4);d.tracks[0].clips[0].speed=r(2);}]){const invalid=fixture(kind);mutate(invalid);assert.throws(()=>validateDocument(invalid),/SPATIAL_TRANSITION_GEOMETRY_UNVERIFIED/);}
 }
});

test('same-resolution native spatial samples retain bounded interior errors while boundary observations stay separate',()=>{
 for(const kind of ['wipe','circle'] as const){
  const data=read(`native-${kind}-canvas720-analysis.json`),samples=data.samples as {frame:number;rgb:number[][]}[],A=samples[0].rgb,B=samples.at(-1)!.rgb;let max=0,total=0,count=0,boundary=0;
  for(const sample of samples)for(const [i,[x,y]] of (data.samplePoints as [number,number][]).entries()){
   const p=(sample.frame-45)/30,radius=p*Math.hypot(1280,720)/2,distance=kind==='wipe'?Math.abs(x+.5-1280*(1-p)):Math.abs(Math.hypot(x+.5-640,y+.5-360)-radius);
   if(distance<4){boundary++;continue;}
   const incoming=kind==='wipe'?x+.5>1280*(1-p):Math.hypot(x+.5-640,y+.5-360)<radius;
   for(let c=0;c<3;c++){const error=Math.abs(sample.rgb[i][c]-(incoming?B:A)[i][c]);max=Math.max(max,error);total+=error;count++;}
  }
  assert(max<=2,`${kind}: native interior max ${max}`);assert(total/count<.01,`${kind}: native interior mean ${total/count}`);assert.equal(boundary,kind==='circle'?28:0);
  assert.equal(data.fullFrameMax,kind==='circle'?230:229,'the original full-frame discrepancy must not be hidden by the interior check');
 }
});

test('actual spatial renders keep same UV, linear mask progress and a pixel-space circle at the admitted resolution',{timeout:120000},async()=>{
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'yingxu-spatial-'));
 try{
  const src=path.join(dir,'source.mp4');execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=red:s=320x180:r=30:d=3','-f','lavfi','-i','color=blue:s=320x180:r=30:d=3','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-crf','0','-y',src]);const asset=await probeAsset(src);
  const times=[0,52,60,68,119],points=[[80,60],[640,360],[1050,360],[640,36],[80,660],[1200,660]];
  for(const kind of ['wipeLeft','circleOpen'] as const){
   const doc=fixture(kind);doc.assets=[{...asset,id:'asset'}];const before=structuredClone(doc);
   await assert.rejects(render(doc,path.join(dir,kind+'-scaled'),{exportSettings:{size:{width:640,height:360}}}),/SPATIAL_TRANSITION_OUTPUT_SIZE_UNVERIFIED/);
   const output=await render(doc,path.join(dir,kind));assert.equal(output.frameCount,120);assert.deepEqual(doc,before);
   const raw=execFileSync(ffmpeg(),['-v','error','-i',output.path,'-vf',`select='${times.map(n=>`eq(n,${n})`).join('+')}'`,'-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:32*1024*1024});const frameBytes=1280*720*3;assert.equal(raw.length,times.length*frameBytes);
   const pixel=(i:number,x:number,y:number)=>[...raw.subarray(i*frameBytes+(y*1280+x)*3,i*frameBytes+(y*1280+x)*3+3)];
   for(let i=1;i<times.length-1;i++)for(const [x,y] of points){const p=(times[i]-45)/30,isB=kind==='wipeLeft'?(x+.5)>1280*(1-p):Math.hypot(x+.5-640,y+.5-360)<p*Math.hypot(1280,720)/2,expected=pixel(isB?times.length-1:0,x,y),actual=pixel(i,x,y);actual.forEach((v,c)=>assert(Math.abs(v-expected[c])<=5,`${kind} frame${times[i]} at${x},${y}: ${actual} vs ${expected}`));}
  }
 }finally{await fsp.rm(dir,{recursive:true,force:true});}
});
