import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational,decimal} from '../packages/core/src/time.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {render} from '../packages/media/src/render.ts';

test('crossfade renders centered windows, fractional frame progress and premultiplied transparency over lower tracks',{timeout:120000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-transition-render-'));
 try{
  const source=path.join(root,'colors.mp4'),green=path.join(root,'green.mp4');
  execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=red:s=160x90:r=30:d=4','-f','lavfi','-i','color=blue:s=160x90:r=30:d=4','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-crf','0','-y',source]);
  execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i','color=0x00ff00:s=160x90:r=30:d=8','-c:v','libx264','-crf','0','-y',green]);
  const asset=await probeAsset(source),background=await probeAsset(green),doc=emptyDocument();doc.canvas={width:160,height:90};doc.assets=[asset,background];
  const pair=doc.tracks[0];pair.clips=[{id:'left',materialId:asset.id,source:{start:rational(1),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,transform:defaultTransform()},
   {id:'right',materialId:asset.id,source:{start:rational(5),duration:rational(2)},target:{start:rational(2),duration:rational(2)},speed:rational(1),editableTiming:true,transform:defaultTransform()}];
  doc.transitions=[{id:'fade',trackId:pair.id,outgoingClipId:'left',incomingClipId:'right',kind:'crossfade',alignment:'center',overlap:true,duration:rational(1)}];
  const pixels=(file:string)=>{const raw=execFileSync(ffmpeg(),['-v','error','-i',file,'-vf','crop=2:2:80:44,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);return Array.from({length:raw.length/3},(_,i)=>[...raw.subarray(i*3,i*3+3)]);};
  const full=await render(doc,path.join(root,'one'));assert.equal(full.frameCount,120);assert.equal(full.duration,4);
  const colors=pixels(full.path);assert.equal(colors.length,120);const red=colors[0],blue=colors[119];
  const checkMix=(actual:number[],p:number,tolerance=6)=>actual.forEach((n,c)=>assert(Math.abs(n-(red[c]*(1-p)+blue[c]*p))<=tolerance,`channel ${c}, p=${p}, pixel=${actual}`));
  for(let frame=45;frame<75;frame++)checkMix(colors[frame],(frame/30-1.5));
  assert(colors[44][0]>245&&colors[75][2]>245,'window does not shift total timeline or leak beyond endpoints');
  doc.transitions[0].duration=decimal('0.5');const half=await render(doc,path.join(root,'half'));const halfColors=pixels(half.path);
  for(let frame=53;frame<68;frame++)checkMix(halfColors[frame],(frame/30-1.75)/.5);
  pair.clips.forEach(c=>c.transform!.opacity=.5);doc.transitions[0].duration=rational(1);
  doc.tracks.unshift({id:'background',kind:'video',clips:[{id:'green',materialId:background.id,source:{start:rational(0),duration:rational(4)},target:{start:rational(0),duration:rational(4)},speed:rational(1),editableTiming:true,muted:true}]});
  const transparent=await render(doc,path.join(root,'transparent')),middle=pixels(transparent.path)[60];
  for(const [n,expected]of middle.map((n,i)=>[n,[63,127,63][i]]))assert(Math.abs(n-expected)<7,`premultiplied midpoint ${middle}`);
  doc.transitions[0].kind='dipToBlack';doc.transitions[0].overlap=false;
  asset.duration=rational(7);pair.clips[0].source.start=rational(5);pair.clips[1].source.start=rational(0);
  const flash=await render(doc,path.join(root,'flash')),flashPixels=pixels(flash.path);
  assert(flashPixels[60].every(n=>n<4),`opaque-black cut must cover lower track ${flashPixels[60]}`);
  for(const frame of [50,55,59,61,65,70]){
   const start=frame<60?flashPixels[45]:flashPixels[75],weight=Math.abs(frame-60)/15;
   flashPixels[frame].forEach((n,c)=>assert(Math.abs(n-start[c]*weight)<7,`flash ${frame} ${flashPixels[frame]}`));
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
