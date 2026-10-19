import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {applyColorAdjustments} from '../packages/core/src/color-effects.ts';
import type {ColorAdjustments,RGB} from '../packages/core/src/color-effects.ts';
import {prepareColorEffects,COLOR_LUT_MAX_FILES,COLOR_LUT_MAX_FILE_BYTES,COLOR_LUT_SAMPLES} from '../packages/media/src/color-effects-fast.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
const adjust=(fields:Omit<ColorAdjustments,'version'>):ColorAdjustments=>({version:'combine-adjust-v2',...fields});

function runFloat(input:Buffer,width:number,height:number,filter:string,directory:string){
  const result=spawnSync(ffmpeg(),['-v','error','-threads','1','-filter_threads','1','-f','rawvideo','-pixel_format','gbrapf32le','-video_size',`${width}x${height}`,'-i','pipe:0','-frames:v','1','-vf',filter||'null','-pix_fmt','gbrapf32le','-f','rawvideo','pipe:1'],{input,cwd:directory,timeout:30000,maxBuffer:input.length*2+1024});
  assert.equal(result.status,0,result.stderr?.toString());assert.equal(result.stdout.length,input.length);return result.stdout;
}

test('fast LUT preparation is canonical, bounded, atomic and validates cache contents',{timeout:30000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"color-fast-'[]:"));
  try{
    const value=adjust({brightness:.5,contrast:.5,saturation:.5,highlight:-.4,shadow:.8});
    const prepared=await Promise.all(Array.from({length:4},()=>prepareColorEffects(value,directory)));
    assert.ok(prepared.every(p=>p.metadata.key===prepared[0].metadata.key&&p.filter===prepared[0].filter));
    assert.equal(prepared[0].files.length,2);assert.equal(prepared[0].metadata.luts.every(l=>!l.cacheHit),true);
    assert.equal(prepared[1].metadata.luts.every(l=>l.cacheHit),true);
    assert.equal((await fs.readdir(directory)).length,2);
    for(const name of prepared[0].files)assert.match(name,/^color-fx-v1-[a-f0-9]{64}\.cube$/);
    assert.ok(!prepared[0].filter.includes(directory));assert.ok(!prepared[0].filter.includes('geq'));
    for(const lut of prepared[0].metadata.luts){assert.ok(lut.bytes<=COLOR_LUT_MAX_FILE_BYTES);assert.equal(lut.samples,COLOR_LUT_SAMPLES);}
    const file=path.join(directory,prepared[0].files[0]),bytes=await fs.readFile(file);bytes[0]=bytes[0]^1;await fs.writeFile(file,bytes);
    await assert.rejects(prepareColorEffects(value,directory),/COLOR_EFFECT_LUT_CORRUPT/);
    await fs.unlink(file);const outside=path.join(directory,'outside.txt');await fs.writeFile(outside,'unchanged');await fs.symlink(outside,file);
    await assert.rejects(prepareColorEffects(value,directory),/COLOR_EFFECT_LUT_UNSAFE_FILE/);assert.equal(await fs.readFile(outside,'utf8'),'unchanged');
    const quota=path.join(directory,'quota');await fs.mkdir(quota);
    for(let i=0;i<COLOR_LUT_MAX_FILES;i++)await fs.writeFile(path.join(quota,`color-fx-v1-${i.toString(16).padStart(64,'0')}.cube`),'bounded placeholder');
    await assert.rejects(prepareColorEffects(adjust({brightness:-.7}),quota),/COLOR_EFFECT_LUT_CACHE_LIMIT/);
    const changing=adjust({brightness:.25}),pending=prepareColorEffects(changing,directory);changing.brightness=-1;
    const frozen=await pending,original=await prepareColorEffects(adjust({brightness:.25}),directory);assert.equal(frozen.metadata.key,original.metadata.key);
    const neutral=await prepareColorEffects(adjust({brightness:0}),path.join(directory,'neutral'));
    assert.equal(neutral.filter,'');assert.deepEqual(neutral.files,[]);await assert.rejects(fs.stat(path.join(directory,'neutral')),{code:'ENOENT'});
    for(const invalid of [{version:'other'},{version:'combine-adjust-v2',brightness:NaN},{version:'combine-adjust-v2',saturation:2},{version:'combine-adjust-v2',contrast:NaN},{version:'combine-adjust-v2',contrast:2},{version:'combine-adjust-v2',brightness:'1,lut3d=evil'}])await assert.rejects(prepareColorEffects(invalid as ColorAdjustments,directory),/INVALID_COLOR_ADJUSTMENTS/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('float LUT/matrix pipeline matches CPU through dense and adversarial edge colours',{timeout:60000},async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'color-fast-pixels-'));
  try{
    const width=4096,height=2,count=width*height,input=Buffer.alloc(count*16);
    const edge=[0,1,1e-10,1e-8,1e-6,1e-5,.0001,.001,.005,.01,.5,128/255,.99,.999,.99999,Math.fround(1-1e-7)];
    for(let i=0;i<count;i++){
      const values=i<4096?[edge[i%edge.length],edge[Math.floor(i/16)%16],edge[Math.floor(i/256)%16]]:[(i-4096+.5)/4096,((i*977)%4096+.5)/4096,((i*317)%4096+.5)/4096];
      for(let c=0;c<3;c++)input.writeFloatLE(values[c],(c*count+i)*4);input.writeFloatLE((i%257)/256,(3*count+i)*4);
    }
    const cases=[adjust({brightness:-1}),adjust({brightness:-.5}),adjust({brightness:.7}),adjust({brightness:1}),adjust({contrast:-1}),adjust({contrast:-.5}),adjust({contrast:.00002}),adjust({contrast:.5}),adjust({contrast:1}),adjust({temperature:-1}),adjust({temperature:1}),adjust({tint:-1}),adjust({tint:1}),adjust({temperature:1,tint:1}),adjust({temperature:-1,tint:-1}),adjust({temperature:.00002,tint:.00002}),adjust({brightness:-1,contrast:-1}),adjust({brightness:1,contrast:1}),adjust({saturation:-1}),adjust({saturation:1}),adjust({highlight:-1,shadow:1}),adjust({highlight:1,shadow:-1}),adjust({brightness:-.99,saturation:1,highlight:-1,shadow:1}),adjust({brightness:.8,contrast:1,saturation:.8,highlight:-1,shadow:-1,temperature:1,tint:1}),adjust({brightness:-.2,contrast:-.8,saturation:-.7,highlight:.8,shadow:.9,temperature:-1,tint:-1})];
    let worst=0;
    for(const value of cases){
      const prepared=await prepareColorEffects(value,directory),output=runFloat(input,width,height,prepared.filter,directory);
      for(let i=0;i<count;i++){
        const rgb:RGB=[input.readFloatLE((2*count+i)*4),input.readFloatLE(i*4),input.readFloatLE((count+i)*4)],expected=applyColorAdjustments(rgb,value);
        const offsets=[2*count,count*0,count];
        for(let c=0;c<3;c++){
          const actual=output.readFloatLE((offsets[c]+i)*4),error=Math.abs(actual-expected[c])*255;worst=Math.max(worst,error);
          assert.ok(Number.isFinite(actual)&&actual>=0&&actual<=1);assert.ok(error<=1,`${JSON.stringify(value)} pixel ${i} channel ${c}: ${actual} vs ${expected[c]} (${error} LSB)`);
        }
        assert.equal(output.readUInt32LE((3*count+i)*4),input.readUInt32LE((3*count+i)*4));
      }
    }
    t.diagnostic(`Dense float comparison: ${cases.length} settings × ${count} pixels; max error ${worst.toFixed(6)} / 255, alpha bits unchanged.`);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('fast colour benchmark processes sixty 720p frames without per-pixel expression evaluation',{timeout:60000},async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'color-fast-benchmark-'));
  try{
    const preparation=performance.now(),prepared=await prepareColorEffects(adjust({brightness:-.5,contrast:.5,saturation:1,highlight:-.8,shadow:.9,temperature:.7,tint:-.5}),directory),preparationMs=performance.now()-preparation;
    const started=performance.now();
    const result=spawnSync(ffmpeg(),['-v','error','-threads','2','-filter_threads','2','-f','lavfi','-i','testsrc2=size=1280x720:rate=30:duration=2','-vf',prepared.filter,'-frames:v','60','-f','null','-'],{cwd:directory,timeout:45000,maxBuffer:1024*1024});
    const seconds=(performance.now()-started)/1000;assert.equal(result.status,0,result.stderr?.toString());assert.ok(seconds<25,`Unexpected slow LUT path: ${seconds}s`);
    t.diagnostic(`720p × 60 frames: preparation ${preparationMs.toFixed(2)} ms; FFmpeg ${seconds.toFixed(3)} s; ${(60/seconds).toFixed(1)} fps; ${prepared.metadata.luts.reduce((s,l)=>s+l.bytes,0)} LUT bytes.`);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
