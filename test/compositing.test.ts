import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runProcess} from '../packages/media/src/process.ts';
import {probeAsset, ffmpeg} from '../packages/media/src/probe.ts';
import {render} from '../packages/media/src/render.ts';
import {emptyDocument, defaultTransform} from '../packages/core/src/document.ts';
import {rational,div} from '../packages/core/src/time.ts';

function pixel(file:string,at:number,x:number,y:number){
  const result=spawnSync(ffmpeg(),['-hide_banner','-loglevel','error','-ss',String(at),'-i',file,'-frames:v','1','-vf',`crop=2:2:${x}:${y},format=rgb24`,'-f','rawvideo','pipe:1']);
  assert.equal(result.status,0,result.stderr.toString());assert(result.stdout.length>=3);return [...result.stdout.subarray(0,3)];
}
test('real pixels verify image speed, layer order, opacity, scaling and visibility', {timeout:60000}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-pixels-'));
  try{
    for(const color of ['red','blue'])await runProcess(ffmpeg(),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`color=c=${color}:s=320x180:d=1`,'-frames:v','1',path.join(dir,color+'.png')]);
    const red=await probeAsset(path.join(dir,'red.png')),blue=await probeAsset(path.join(dir,'blue.png'));
    assert.equal(red.kind,'image');const doc=emptyDocument();doc.canvas={width:320,height:180};doc.assets.push(red,blue);
    doc.tracks[0].clips.push({id:'red',materialId:red.id,source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(1)},speed:rational(2),editableTiming:true});
    const base=await render(doc,path.join(dir,'base'));const last=pixel(base.path,.9,10,10);
    assert(last[0]>200&&last[1]<30&&last[2]<30,`sped image disappeared before its end: ${last}`);
    doc.tracks.push({id:'overlay',kind:'video',clips:[{id:'blue',materialId:blue.id,source:{start:rational(0),duration:rational(1)},target:{start:rational(0),duration:rational(1)},speed:rational(1),editableTiming:true,transform:{...defaultTransform(),scale:.5,opacity:.5}}]});
    const layered=await render(doc,path.join(dir,'layers')),center=pixel(layered.path,.5,160,90),corner=pixel(layered.path,.5,10,10);
    assert(center[0]>90&&center[0]<160&&center[2]>90&&center[2]<160,`center not blended: ${center}`);
    assert(corner[0]>200&&corner[2]<30,`scaling covered corner: ${corner}`);
    doc.tracks[3].hidden=true;const hidden=await render(doc,path.join(dir,'hidden')),color=pixel(hidden.path,.5,160,90);
    assert(color[0]>200&&color[2]<30,`hidden layer still visible: ${color}`);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('cancelling a running native process waits for that process to exit', {timeout:10000},async()=>{
  const controller=new AbortController();let began=false;
  const process=runProcess(ffmpeg(),['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=1280x720:r=30','-t','600','-progress','pipe:1','-f','null','-'],{
    signal:controller.signal,onLine:line=>{if(line.startsWith('out_time_us=')&&Number(line.slice(12))>0){began=true;controller.abort();}}
  });
  await assert.rejects(process,/JOB_CANCELLED/);assert(began,'the native process never started');
});
test('30fps, 60fps and NTSC one-frame ranges do not drift at fractional seconds', {timeout:30000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-frame-edge-'));
  try{
    await runProcess(ffmpeg(),['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=red:s=320x180:d=1','-frames:v','1',path.join(dir,'red.png')]);
    const a=await probeAsset(path.join(dir,'red.png'));
    for(const rate of [rational(30),rational(60),rational(30000,1001)]){
    const step=div(rational(1),rate),doc=emptyDocument();doc.canvas={width:320,height:180};doc.fps=rate;doc.assets.push(a,{id:'text',kind:'text',path:'',duration:rational(3600)});
    doc.tracks[0].clips.push({id:'red',materialId:a.id,source:{start:rational(0),duration:step},target:{start:step,duration:step},speed:rational(1),editableTiming:true});
    doc.tracks[2].clips.push({id:'t',materialId:'text',source:{start:rational(0),duration:step},target:{start:rational(0),duration:step},speed:rational(1),editableTiming:true,text:{content:'A',size:60,color:'#ffffff',font:'Arial'},transform:defaultTransform()});
    const result=await render(doc,path.join(dir,'render-'+rate.numerator));
    const raw=spawnSync(ffmpeg(),['-hide_banner','-loglevel','error','-i',result.path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
    assert.equal(raw.status,0,raw.stderr.toString());const stride=320*180*3;assert.equal(raw.stdout.length,stride*2);
    assert(raw.stdout[ stride+3*(10*320+10) ]>200,'image failed to start at frame 1');
    const green=(start:number)=>{let count=0;for(let i=start+1;i<start+stride;i+=3)if(raw.stdout[i]>100)count++;return count;};
    assert(green(0)>20,'text absent from frame 0');assert.equal(green(stride),0,'text leaked into excluded frame 1');
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
