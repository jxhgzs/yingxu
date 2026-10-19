import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {emptyDocument,defaultTransform,validateDocument} from '../packages/core/src/document.ts';
import {rational as r} from '../packages/core/src/time.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {importJianying} from '../packages/jianying/src/import.ts';
import {isKnownTransitionMaterial} from '../packages/jianying/src/transitions.ts';
import {createPreviewPlan,previewFrame,transitionWeights} from '../apps/editor/src/preview/plan.ts';
import {buildTransitionCandidate} from '../apps/editor/src/transition-candidate.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {render} from '../packages/media/src/render.ts';
const read=(name:string)=>JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-rea-transitions-v8/'+name,import.meta.url),'utf8'));

test('real artistEffect white flash identity imports exact nonoverlap semantics and rejects unobserved variants',()=>{
 const raw=read('11-flash-white-native-1s.json'),before=structuredClone(raw),result=importJianying(raw),transition=result.document.transitions![0];
 assert.deepEqual(result.diagnostics,[]);const alpha=importJianying(read('14c-alpha-white-native-corrected.json'));assert.deepEqual(alpha.diagnostics,[]);assert.deepEqual(alpha.document.tracks.flatMap(t=>t.clips).filter(c=>c.materialId!==alpha.document.tracks.find(t=>t.clips.length===1)?.clips[0]?.materialId).map(c=>c.transform?.opacity),[.5,.5]);assert.equal(transition.kind,'dipToWhite');assert.equal(transition.overlap,false);assert.deepEqual(transition.duration,r(1));assert.deepEqual(raw,before);assert.deepEqual(result.provenance.raw,before);
 for(const change of [{is_overlap:true},{effect_id:'322575'},{resource_id:'other'},{name:'闪白 II'},{path:'/artistEffect/6724845376098013708/unknown'}])assert.equal(isKnownTransitionMaterial({...raw.materials.transitions[0],...change}),false);
 const next=applyCommand(result.document,{type:'transition.update',transitionId:transition.id,changes:{kind:'dipToBlack'}});assert.equal(next.transitions![0].overlap,false);validateDocument(next);
});

test('white flash GPU weights match opaque and semitransparent native frames across 48 calibrated spatial patches',()=>{
 for(const [file,maxAllowed,meanAllowed] of [['native-flash-white-analysis.json',6,1.2],['native-alpha-white-corrected-analysis.json',4.1,1.25]] as const){
  const evidence=read(file),samples=evidence.samples as number[][][],A=samples[0],B=samples.at(-1)!;let sum=0,count=0,max=0;
  for(let frame=45;frame<=75;frame++){
   const [a,b,white]=transitionWeights('dipToWhite',(frame-45)/30);
   for(let point=0;point<A.length;point++)for(let channel=0;channel<3;channel++){
    const expected=A[point][channel]*a+B[point][channel]*b+255*white,error=Math.abs(samples[frame][point][channel]-expected);sum+=error;count++;max=Math.max(max,error);
   }
  }
  assert(max<=maxAllowed,`${file}: native encoded RGB maximum ${max}`);assert(sum/count<meanAllowed,`${file}: native mean ${sum/count}`);
 }
 assert.deepEqual(transitionWeights('dipToWhite',.5),[0,0,1]);
});

test('white flash preview uses one current decoder and unchanged audio cut without needing handles',()=>{
 const doc=emptyDocument();doc.canvas={width:320,height:180};doc.fps=r(30);doc.assets=[{id:'v',path:'/not-read.mp4',kind:'video',duration:r(2),width:320,height:180,hasAudio:true,fps:r(30)}];
 doc.tracks[0].clips=['a','b'].map((id,i)=>({id,materialId:'v',source:{start:r(0),duration:r(2)},target:{start:r(i*2),duration:r(2)},speed:r(1),editableTiming:true,transform:defaultTransform()}));
 const candidate=buildTransitionCandidate(doc,doc.tracks[0].id,'a','dipToWhite');assert.ok(candidate.transition,candidate.reason);doc.transitions=[{...candidate.transition,duration:r(1)}];
 const result=createPreviewPlan(doc);assert.equal(result.support.supported,true);assert.equal(result.support.maxConcurrentMedia,1);
 for(const [time,id] of [[r(19,10),'a'],[r(2),'b'],[r(21,10),'b']] as const){const frame=previewFrame(result.plan!,time);assert.deepEqual(frame.media.map(l=>l.clip.id),[id]);assert.deepEqual(frame.audio.map(l=>l.clip.id),[id]);assert.equal(frame.layers[0].transition?.kind,'dipToWhite');}
});

test('real white flash render reaches opaque white over a lower track and preserves centred timing',{timeout:120000},async()=>{
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'yingxu-white-'));
 try{
  const source=path.join(dir,'source.mp4'),green=path.join(dir,'green.mp4');
  execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=red:s=160x90:r=30:d=4','-f','lavfi','-i','color=blue:s=160x90:r=30:d=4','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-crf','0','-y',source]);
  execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=0x00ff00:s=160x90:r=30:d=4','-c:v','libx264','-crf','0','-y',green]);
  const asset=await probeAsset(source),background=await probeAsset(green),doc=emptyDocument();doc.canvas={width:160,height:90};doc.fps=r(30);doc.assets=[asset,background];const track=doc.tracks[0];
  track.clips=[{id:'a',materialId:asset.id,source:{start:r(0),duration:r(2)},target:{start:r(0),duration:r(2)},speed:r(1),editableTiming:true,transform:{...defaultTransform(),opacity:.5}},{id:'b',materialId:asset.id,source:{start:r(4),duration:r(2)},target:{start:r(2),duration:r(2)},speed:r(1),editableTiming:true,transform:{...defaultTransform(),opacity:.5}}];
  doc.tracks.unshift({id:'green',kind:'video',clips:[{id:'bg',materialId:background.id,source:{start:r(0),duration:r(4)},target:{start:r(0),duration:r(4)},speed:r(1),editableTiming:true}]});
  doc.transitions=[{id:'white',trackId:track.id,outgoingClipId:'a',incomingClipId:'b',kind:'dipToWhite',alignment:'center',overlap:false,duration:r(1)}];const before=structuredClone(doc),output=await render(doc,path.join(dir,'out'));assert.equal(output.frameCount,120);assert.deepEqual(doc,before);
  const pixels=execFileSync(ffmpeg(),['-v','error','-i',output.path,'-vf','crop=2:2:80:44,scale=1:1','-pix_fmt','rgb24','-f','rawvideo','-']);assert.equal(pixels.length,360);const at=(n:number)=>[...pixels.subarray(n*3,n*3+3)];
  assert(at(60).every(v=>v>=252),`white must be opaque across lower green: ${at(60)}`);
  const A=at(0),B=at(119);
  for(let n=45;n<=75;n++){const [a,b,w]=transitionWeights('dipToWhite',(n-45)/30);at(n).forEach((value,c)=>assert(Math.abs(value-(A[c]*a+B[c]*b+255*w))<7,`frame ${n} channel ${c}: ${at(n)}`));}
  assert.deepEqual(at(44),A);assert.deepEqual(at(76),B);
 }finally{await fsp.rm(dir,{recursive:true,force:true});}
});
