import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
import {render} from '../packages/media/src/render.ts';
import {runProcess} from '../packages/media/src/process.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import type {Animation,AnimatedProperty} from '../packages/core/src/animation.ts';

const ramp=(property:AnimatedProperty,a:number,b:number):Animation=>({property,points:[{id:property+'0',time:rational(0),value:a,interpolation:'linear'},{id:property+'1',time:rational(1),value:b,interpolation:'linear'}]});
function frame(file:string,time:number,width:number,height:number){
  const r=spawnSync(ffmpeg(),['-hide_banner','-loglevel','error','-ss',String(time),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  assert.equal(r.status,0,r.stderr.toString());assert.equal(r.stdout.length,width*height*3);
  return (x:number,y:number)=>[...r.stdout.subarray((y*width+x)*3,(y*width+x)*3+3)];
}
test('animated size, position and alpha render source-clock events at changed speeds',{timeout:60000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-animation-'));
  try{
    await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i','color=red:s=128x64','-frames:v','1',path.join(dir,'red.png')]);
    const a=await probeAsset(path.join(dir,'red.png')),d=emptyDocument();d.canvas={width:128,height:64};d.fps=rational(20);d.assets.push(a);
    const c={id:'red',materialId:a.id,source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,transform:defaultTransform(),animations:[ramp('scale',.25,.5),ramp('x',0,24),ramp('opacity',.25,1)]};
    d.tracks[0].clips.push(c);
    const slow=await render(d,path.join(dir,'slow')),p0=frame(slow.path,0,128,64),p1=frame(slow.path,1,128,64);
    assert(p0(64,32)[0]>45&&p0(64,32)[0]<90,`start opacity ${p0(64,32)}`);
    assert(p0(90,32)[0]<20,'initial image too wide');
    assert(p1(90,32)[0]>230,'end position/scale/opacity incorrect');
    assert(p1(50,32)[0]<20,'end position did not move');
    c.speed=rational(2);c.target={start:rational(1),duration:rational(1)};
    const fast=await render(d,path.join(dir,'fast')),pFast=frame(fast.path,1.5,128,64);
    for(const [x,y] of [[50,32],[90,32],[120,32]])assert(Math.abs(pFast(x,y)[0]-p1(x,y)[0])<8,'same source event differs after move and 2x');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('animated rotation keeps rectangle corners and audio automation changes decoded PCM gain',{timeout:60000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-rotation-'));
  try{
    await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i','color=red:s=80x20','-frames:v','1',path.join(dir,'red.png')]);
    const a=await probeAsset(path.join(dir,'red.png')),d=emptyDocument();d.canvas={width:160,height:160};d.fps=rational(20);d.assets.push(a);
    d.tracks[0].clips.push({id:'red',materialId:a.id,source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,transform:{...defaultTransform(),scale:.5},animations:[ramp('rotation',0,90)]});
    const result=await render(d,path.join(dir,'rotation')),p=frame(result.path,1,160,160);
    assert(p(80,48)[0]>200&&p(80,112)[0]>200,'rotating corners cropped');assert(p(48,80)[0]<20,'rotation absent');
    await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2',path.join(dir,'tone.wav')]);
    const audio=await probeAsset(path.join(dir,'tone.wav'));d.assets.push(audio);
    d.tracks[1].clips.push({id:'tone',materialId:audio.id,source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,volume:0,animations:[ramp('volume',0,1)]});
    const mixed=await render(d,path.join(dir,'audio'));
    const raw=spawnSync(ffmpeg(),['-v','error','-i',mixed.path,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']);assert.equal(raw.status,0,raw.stderr.toString());
    const rms=(at:number)=>{let s=0;const n=4800;for(let i=0;i<n;i++){const x=raw.stdout.readFloatLE(4*(Math.round(at*48000)+i));s+=x*x;}return Math.sqrt(s/n);};
    assert(rms(.1)>0&&rms(.1)<rms(1.3)*.3,'volume ramp not applied');assert(rms(1.3)>.04,'zero base volume incorrectly suppressed automation');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('text keyframes use the same source clock and visible output frame intervals',{timeout:30000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-text-animation-'));
  try{
    const d=emptyDocument();d.canvas={width:160,height:160};d.fps=rational(20);d.assets.push({id:'text',kind:'text',path:'',duration:rational(3600)});
    d.tracks[2].clips.push({id:'t',materialId:'text',source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,
      text:{content:'M',size:40,font:'Arial',color:'#ffffff'},transform:defaultTransform(),animations:[ramp('x',0,30),ramp('opacity',.4,1)]});
    const output=await render(d,dir);
    const box=(at:number)=>{const p=frame(output.path,at,160,160);let min=160,max=0,peak=0;for(let y=0;y<160;y++)for(let x=0;x<160;x++){const green=p(x,y)[1];peak=Math.max(peak,green);if(green>50){min=Math.min(min,x);max=Math.max(max,x);}}return {center:(min+max)/2,peak};};
    const a=box(0),b=box(1);assert(Math.abs(b.center-a.center-30)<2,`text position ${JSON.stringify({a,b})}`);assert(a.peak<140&&b.peak>230,'text opacity not animated');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
