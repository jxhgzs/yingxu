import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
import {resolveExportSettings} from '../packages/core/src/export.ts';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {render} from '../packages/media/src/render.ts';
import {ffmpeg,probeAsset} from '../packages/media/src/probe.ts';
import {baselineRoot} from './fixtures.ts';
import type {ExportSettings} from '../packages/core/src/export.ts';

export function exportExample(){
  const d=emptyDocument();d.canvas={width:1280,height:720};d.assets.push({id:'a',path:'/fixture',duration:rational(6)});
  d.tracks[0].clips.push({id:'c',materialId:'a',source:{start:rational(0),duration:rational(6)},target:{start:rational(0),duration:rational(6)},speed:rational(1),editableTiming:true});return d;
}
test('export defaults match measured target container profiles and exact frame windows',()=>{
  const d=exportExample(),before=structuredClone(d),mov=resolveExportSettings(d,{format:'mov'});
  assert.equal(mov.audioSampleRate,44100);assert.equal(mov.extension,'mov');assert.equal(mov.mime,'video/quicktime');assert.equal(mov.frameCount,180);
  const gif=resolveExportSettings(d,{format:'gif'});assert.deepEqual([gif.width,gif.height,gif.fps],[426,240,rational(10)]);assert.equal(gif.frameCount,60);
  const selected=resolveExportSettings(d,{fps:rational(30000,1001),range:{start:rational(1),duration:rational(1)}});
  assert.deepEqual([selected.startFrame,selected.endFrame,selected.frameCount],[30,60,30]);
  assert.deepEqual(d,before);
});
test('invalid export configuration is rejected before a native process starts',()=>{
  const d=exportExample();
  for(const input of [
    {format:'avi'},{format:'gif',fps:rational(30)},{size:{width:1279,height:720}},
    {size:{width:1280,height:1280}},{audioSampleRate:12345},{videoBitrateKbps:Infinity},
    {range:{start:rational(-1),duration:rational(1)}},{range:{start:rational(6),duration:rational(1)}},
    {range:{start:rational(0),duration:rational(0)}},{format:'mp3',audioBitrateKbps:500},
  ])assert.throws(()=>resolveExportSettings(d,input as any));
  assert.throws(()=>resolveExportSettings(emptyDocument()),/EMPTY_TIMELINE/);
});
test('six actual containers plus HEVC honor settings and the selected source frame',{timeout:120000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingxu-export-'));
  try{
    const asset=await probeAsset(path.join(baselineRoot,'fixtures/timeline-probe.mp4')),d=exportExample();d.assets=[asset];d.tracks[0].clips[0].materialId=asset.id;
    const configurations:ExportSettings[]=[{format:'mov'},{format:'mp4',videoCodec:'hevc',size:{width:320,height:180},fps:rational(24)},
      {format:'mp3'},{format:'wav',audioSampleRate:48000},{format:'m4a'},{format:'gif'}];
    for(const settings of configurations){
      const result=await render(d,path.join(dir,settings.format!),{exportSettings:{...settings,range:{start:rational(1),duration:rational(1)}}});
      assert.equal(path.extname(result.path),'.'+settings.format);
      const video=result.info.streams.find((s:any)=>s.codec_type==='video'),audio=result.info.streams.find((s:any)=>s.codec_type==='audio');
      const decode=spawnSync(ffmpeg(),['-v','error','-i',result.path,'-f','null','-']);assert.equal(decode.status,0,decode.stderr.toString());
      if(['mp3','wav','m4a'].includes(settings.format!)){
        assert(!video);assert.equal(audio.codec_name,({mp3:'mp3',wav:'pcm_s16le',m4a:'aac'} as Record<string,string>)[settings.format!]);assert.equal(Number(audio.sample_rate),settings.audioSampleRate??44100);
      }else if(settings.format==='gif'){
        assert.equal(video.codec_name,'gif');assert(!audio);assert.equal(video.width,426);assert.equal(video.height,240);assert.equal(Number(video.nb_frames),10);assert.equal(result.duration,1);
      }else{
        assert.equal(video.codec_name,settings.videoCodec==='hevc'?'hevc':'h264');assert.equal(Number(audio.sample_rate),44100);assert.equal(Number(video.nb_frames),settings.fps?24:30);
        if(settings.format==='mov'){
          assert.equal(result.info.format.tags.major_brand,'qt  ');assert.equal(video.width,1280);
          const read=(file:string,at:string)=>{const r=spawnSync(ffmpeg(),['-v','error','-ss',at,'-i',file,'-frames:v','1','-vf','scale=320:180','-pix_fmt','rgb24','-f','rawvideo','pipe:1']);assert.equal(r.status,0,r.stderr.toString());return r.stdout;};
          const actual=read(result.path,'0'),expected=read(asset.path,'1');assert.equal(actual.length,expected.length);
          let delta=0;for(let i=0;i<actual.length;i++)delta+=Math.abs(actual[i]-expected[i]);assert(delta/actual.length<4,'range started at the wrong source frame');
        }
      }
    }
    assert.deepEqual(d.fps,rational(30));assert.deepEqual(d.canvas,{width:1280,height:720});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
