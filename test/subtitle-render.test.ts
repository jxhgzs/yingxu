import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import type {Document,Clip} from '../packages/core/src/document.ts';
import {rational,div,mul} from '../packages/core/src/time.ts';
import {renderGraph} from '../packages/media/src/graph.ts';
import {render} from '../packages/media/src/render.ts';
import {ffmpeg,probeAsset} from '../packages/media/src/probe.ts';
import {runProcess} from '../packages/media/src/process.ts';
import {parseSubtitles} from '../packages/core/src/subtitles.ts';
import {applySubtitleImport} from '../packages/core/src/subtitle-import.ts';

function document():Document {
  const d=emptyDocument();d.canvas={width:320,height:180};d.fps=rational(30);
  d.assets.push({id:'text',kind:'text',path:'',duration:rational(3600)});return d;
}
function caption(id:string,start=rational(0),length=rational(1),content='M',color='#ffffff'):Clip {
  return {id,materialId:'text',source:{start:rational(0),duration:length},target:{start,duration:length},speed:rational(1),editableTiming:true,
    transform:defaultTransform(),text:{content,size:50,color,font:'PingFang SC'}};
}
function decoded(file:string,at=0){
  const r=spawnSync(ffmpeg(),['-v','error','-ss',String(at),'-i',file,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  assert.equal(r.status,0,r.stderr.toString());assert.equal(r.stdout.length,320*180*3);return r.stdout;
}
function count(raw:Buffer,predicate:(r:number,g:number,b:number,x:number,y:number)=>boolean){
  let n=0;for(let y=0;y<180;y++)for(let x=0;x<320;x++){const i=(y*320+x)*3;if(predicate(raw[i],raw[i+1],raw[i+2],x,y))n++;}return n;
}
test('5000 captions use one ASS filter, preserving every cue and explicit render limits',{timeout:60000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-caption-batch-'));
  try {
    const d=document(),step=div(rational(1),d.fps);
    for(let i=0;i<5000;i++){
      const c=caption('cue-'+i,mul(rational(i),step),step,'cue'+i);c.text!.font='Arial';d.tracks[2].clips.push(c);
    }
    assert.equal(renderGraph(d).layers.length,5000);
    d.assets.push({id:'media-limit',path:'/unused.mp4',duration:rational(1)});
    for(let i=0;i<300;i++)d.tracks[0].clips.push({...caption('media-'+i),materialId:'media-limit',text:undefined});
    assert.equal(renderGraph(d).layers.length,5300);
    d.tracks[0].clips=[];
    d.tracks[2].clips.push(caption('too-many'));
    assert.throws(()=>renderGraph(d),/RENDER_LIMIT/);d.tracks[2].clips.pop();
    const result=await render(d,dir,{exportSettings:{range:{start:rational(0),duration:rational(1)}}});
    const filter=await fs.readFile(path.join(dir,'filter.txt'),'utf8');
    assert.equal((filter.match(/subtitles=filename=/g)||[]).length,1);
    const files=(await fs.readdir(dir)).filter(f=>f.endsWith('.ass'));assert.equal(files.length,1);
    const ass=await fs.readFile(path.join(dir,files[0]),'utf8');
    assert.equal((ass.match(/^Style:/gm)||[]).length,5000);assert.equal((ass.match(/^Dialogue:/gm)||[]).length,5000);
    assert(count(decoded(result.path),(_r,g)=>g>100)>40,'first native caption absent');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('text overlap order and a media layer between groups retain compositor order',{timeout:30000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-caption-layers-'));
  try {
    const d=document();d.tracks[2].clips.push(caption('red',rational(0),rational(1),'M','#ff0000'),caption('blue',rational(0),rational(1),'M','#0000ff'));
    const stacked=await render(d,path.join(dir,'stacked')),raw=decoded(stacked.path);
    assert(count(raw,(r,g,b)=>b>200&&r<50&&g<50)>100,'later text did not cover earlier text');
    assert(count(raw,(r,_g,b)=>r>150&&b<50)<40,'lower text showed through same glyph');
    await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i','color=green:s=320x180','-frames:v','1',path.join(dir,'green.png')]);
    const a=await probeAsset(path.join(dir,'green.png'));d.assets.push(a);
    d.tracks.push({id:'middle',kind:'video',clips:[{id:'green',materialId:a.id,source:{start:rational(0),duration:rational(1)},target:{start:rational(0),duration:rational(1)},speed:rational(1),editableTiming:true}]});
    d.tracks.push({id:'top',kind:'text',clips:[caption('white',rational(0),rational(1),'中文\n字幕')]});
    const interleaved=await render(d,path.join(dir,'interleaved')),pixels=decoded(interleaved.path);
    const filter=await fs.readFile(path.join(dir,'interleaved/filter.txt'),'utf8');
    assert.equal((filter.match(/subtitles=filename=/g)||[]).length,2);
    assert(count(pixels,(r,_g,b)=>r>150&&b<50)<10,'text below opaque media moved above it');
    assert(count(pixels,(r,_g,b)=>b>150&&r<50)<10,'blue text below opaque media moved above it');
    assert(count(pixels,(r,g,b,_x,y)=>r>200&&g>200&&b>200&&y<90)>100,'Chinese first line absent');
    assert(count(pixels,(r,g,b,_x,y)=>r>200&&g>200&&b>200&&y>=90)>100,'Chinese second line absent');
    const subframe=document();subframe.tracks[2].clips.push(caption('invisible',rational(1,300),rational(1,300)));
    const invisible=await render(subframe,path.join(dir,'subframe'));
    assert.equal(count(decoded(invisible.path),(_r,g)=>g>50),0,'subframe cue appeared before its first visible frame');
    assert.equal((await fs.readFile(path.join(dir,'subframe/filter.txt'),'utf8')).includes('subtitles='),false);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('media limit remains 300 and dynamic caption event limits fail explicitly',async()=>{
  const d=document();d.assets.push({id:'media',path:'/unused.mp4',duration:rational(1)});
  for(let i=0;i<301;i++)d.tracks[0].clips.push({...caption('m'+i),materialId:'media',text:undefined});
  assert.throws(()=>renderGraph(d),/RENDER_LIMIT/);
  const huge=document();huge.fps=rational(30);
  const c=caption('animated',rational(0),rational(3600));
  c.animations=[{property:'x',points:[{id:'a',time:rational(0),value:0,interpolation:'linear'},{id:'b',time:rational(3600),value:1,interpolation:'linear'}]}];
  huge.tracks[2].clips.push(c);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-caption-limit-'));
  try {await assert.rejects(render(huge,dir),/TEXT_RENDER_EVENT_LIMIT/);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
  const overHour=document();overHour.assets[0].duration=rational(7200);
  overHour.tracks[2].clips.push(caption('over-hour',rational(0),rational(3601)));
  assert.throws(()=>renderGraph(overHour),/RENDER_LIMIT/);
});
test('SRT freezes its official font and separates multiline baselines from glyph normalization',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-caption-font-'));
 try{
  const d=emptyDocument();d.canvas={width:1280,height:720};
  const imported=applySubtitleImport(d,parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n中文测试\n中文测试','srt'),{idPrefix:'font'}).document;
  const output=await render(imported,dir),ass=await fs.readFile(path.join(dir,'captions-0.ass'),'utf8');
  assert.equal((ass.match(/^Dialogue:/gm)||[]).length,2);assert.match(ass,/\\pos\(640,629\)/);assert.match(ass,/\\pos\(640,667\)/);
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'fonts.json'),'utf8'));assert.equal(manifest.length,1);assert.match(manifest[0].sha256,/^[a-f0-9]{64}$/);
  const raw=spawnSync(ffmpeg(),['-v','error','-i',output.path,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:4*1024*1024});assert.equal(raw.status,0,raw.stderr.toString());
  const bands:{first:number;last:number}[]=[];
  for(let y=580;y<710;y++){let count=0;for(let x=0;x<1280;x++){const i=(y*1280+x)*3;if(raw.stdout[i]>180&&raw.stdout[i+1]>180&&raw.stdout[i+2]>180)count++;}
   if(count>2){const prior=bands.at(-1);if(prior&&y-prior.last===1)prior.last=y;else bands.push({first:y,last:y});}
  }
  assert.equal(bands.length,2,JSON.stringify(bands));const center=(b:{first:number;last:number})=>(b.first+b.last)/2;
  assert(Math.abs(center(bands[1])-center(bands[0])-38)<2,JSON.stringify(bands));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
