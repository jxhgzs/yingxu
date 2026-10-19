import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {emptyDocument,defaultTransform,validateDocument} from '../packages/core/src/document.ts';
import type {Asset} from '../packages/core/src/document.ts';
import {rational as r,toNumber,frameTime,micros} from '../packages/core/src/time.ts';
import {transitionBoundaryPolicy,transitionSourceAt} from '../packages/core/src/transitions.ts';
import {createPreviewPlan,previewFrame,sourceBoundaryHeld,sourceSeekTime} from '../apps/editor/src/preview/plan.ts';
import {probeAsset,ffmpeg} from '../packages/media/src/probe.ts';
import {detectCfr30} from '../packages/media/src/frame-timing.ts';
import {render} from '../packages/media/src/render.ts';

function doc(asset:Asset={id:'v',kind:'video',path:'/not-read.mp4',duration:r(6),width:160,height:90,fps:r(30),frameTiming:'cfr30'}){const d=emptyDocument();d.canvas={width:160,height:90};d.assets=[asset];d.tracks[0].clips=['left','right'].map((id,i)=>({id,materialId:asset.id,source:{start:r(0),duration:r(6)},target:{start:r(6*i),duration:r(6)},speed:r(1),editableTiming:true,muted:true,transform:defaultTransform()}));d.transitions=[{id:'d',trackId:d.tracks[0].id,outgoingClipId:'left',incomingClipId:'right',kind:'crossfade',alignment:'center',overlap:true,duration:r(1)}];return d;}
async function fixtures(root:string){const cfr=path.join(root,'cfr.mp4'),vfr=path.join(root,'vfr.mp4'),vfrRaw=path.join(root,'vfr-raw.mp4');
 execFileSync(ffmpeg(),['-v','error','-f','lavfi','-i',"nullsrc=s=160x90:r=30:d=6,format=rgb24,geq=r='32+12*mod(N,16)':g='32+16*floor(N/16)':b='64'",'-c:v','libx264','-pix_fmt','yuv444p','-crf','0','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-color_range','tv','-y',cfr]);
 execFileSync(ffmpeg(),['-v','error','-i',cfr,'-vf',"settb=1/60000,setpts=N*2000+if(lt(N\\,179)*mod(N\\,2)\\,500\\,0)",'-fps_mode','vfr','-enc_time_base','1/60000','-video_track_timescale','60000','-c:v','libx264','-crf','0','-y',vfrRaw]);
 execFileSync(ffmpeg(),['-v','error','-i',vfrRaw,'-c','copy','-bsf:v','setts=duration=2000','-video_track_timescale','60000','-y',vfr]);
 return {cfr,vfr};}
function pixels(file:string){const raw=execFileSync(ffmpeg(),['-v','error','-i',file,'-vf','crop=2:2:80:44,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);return Array.from({length:raw.length/3},(_,i)=>[...raw.subarray(i*3,i*3+3)]);}

test('CFR30 clone admission requires explicit measured timing, aligned ranges and unchanged 1x edit clocks',()=>{
 const d=doc(),before=structuredClone(d),[left,right]=d.tracks[0].clips;assert.doesNotThrow(()=>validateDocument(d));assert.equal(transitionBoundaryPolicy(d.fps,d.transitions![0],left,right,d.assets[0],d.assets[0]),'clone-cfr30');assert.deepEqual(d,before);assert.deepEqual(transitionSourceAt(right,r(11,2)),r(-1,2));
 const bad=[(x:any)=>{delete x.assets[0].frameTiming;},(x:any)=>{x.fps=r(24);},(x:any)=>{x.fps=r(60);},(x:any)=>{delete x.assets[0].frameTiming;x.assets[0].fps=r(24);},(x:any)=>{x.assets[0].duration=r(301);},(x:any)=>{x.transitions[0].duration=r(1,2);},(x:any)=>{x.tracks[0].clips[1].source={start:micros(1),duration:micros(5999999)};x.tracks[0].clips[1].target.duration=micros(5999999);},(x:any)=>{for(const [i,c]of x.tracks[0].clips.entries()){c.speed=r(2);c.target={start:r(i*3),duration:r(3)};}}];
 for(const mutate of bad){const x=doc();mutate(x);assert.throws(()=>validateDocument(x),/TRANSITION_SOURCE_HANDLES_MISSING/);}
 const unknown=doc();(unknown.assets[0]as any).frameTiming='vfr';assert.throws(()=>validateDocument(unknown),/INVALID_MEDIA_FRAME_TIMING/);
 const curve=doc();curve.tracks[0].clips[1].speedCurve={points:[{x:0,y:1},{x:1,y:1}]};assert.throws(()=>validateDocument(curve),/TRANSITION_TIME_MAPPING_UNSUPPORTED/);
});

test('all 30 native zero-handle samples use measured endpoint frames and retain linear centre clock',async()=>{
 const native=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-transition-boundaries-v7/zero-handles-observations.json',import.meta.url),'utf8')),palette=native.unaffectedPairCalibration.palette,d=doc(),plan=createPreviewPlan(d).plan!;let max=0,total=0,blackSquared=0;
 assert.equal(plan.frameCount,360);assert.equal(plan.duration,12);
 for(let n=165;n<195;n++){const left=previewFrame(plan,frameTime(n,d.fps)).layers[0],right=left.transition!.incoming,p=left.transition!.progress,li=Math.round(toNumber(left.sourceTime)*30),ri=Math.round(toNumber(right.sourceTime)*30);assert.equal(li,Math.min(n,179));assert.equal(ri,Math.max(n-180,0));assert(Math.abs(p-(n-165)/30)<1e-12);
  for(let c=0;c<3;c++){const predicted=palette[li][c]*(1-p)+palette[ri][c]*p,error=Math.abs(predicted-native.rows[n].rgb[c]);max=Math.max(max,error);total+=error;const black=(n<180?palette[n][c]*(1-p):palette[n-180][c]*p);blackSquared+=(black-native.rows[n].rgb[c])**2;}
 }
 assert(max<2.334);assert(total/90<.753);assert(Math.sqrt(blackSquared/90)>20,'native samples must reject transparent/black padding');
 const [outgoing,incoming]=d.tracks[0].clips;assert(sourceBoundaryHeld(incoming,d.assets[0],frameTime(165,d.fps)));assert(sourceBoundaryHeld(outgoing,d.assets[0],frameTime(194,d.fps)));assert(!sourceBoundaryHeld(incoming,d.assets[0],r(6)));assert(!sourceBoundaryHeld(outgoing,d.assets[0],r(359,60)),'a valid last-frame interval must keep its audio decoder running');
 assert(sourceSeekTime(outgoing,d.assets[0],frameTime(194,d.fps),d.fps)>179/30&&sourceSeekTime(outgoing,d.assets[0],frameTime(194,d.fps),d.fps)<6);assert(sourceSeekTime(incoming,d.assets[0],frameTime(165,d.fps),d.fps)<1/30);
});

test('real FFprobe PTS proves CFR30, rejects equal-average VFR and render distrusts forged marker',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'transition-timing-'));
 try{const paths=await fixtures(root),cfr=await probeAsset(paths.cfr),vfr=await probeAsset(paths.vfr);assert.deepEqual(cfr.fps,r(30));assert.deepEqual(vfr.fps,r(30),'VFR fixture must have the same average rate as CFR');assert.equal(await detectCfr30(cfr),'cfr30');assert.equal(await detectCfr30(vfr),undefined);assert.equal(await detectCfr30({...cfr,duration:r(301)}),undefined);
  await assert.rejects(render(doc({...vfr,frameTiming:'cfr30'}),path.join(root,'forged')),/TRANSITION_SOURCE_FRAME_TIMING_UNVERIFIED/);
  const shifted=path.join(root,'shifted.mp4');execFileSync(ffmpeg(),['-v','error','-i',paths.cfr,'-vf','setpts=PTS+1/TB','-c:v','libx264','-crf','0','-fps_mode','passthrough','-y',shifted]);const nonzero=await probeAsset(shifted);assert.equal(await detectCfr30(nonzero),undefined,'nonzero first PTS is not a source-zero clock proof');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('real encoded zero-handle crossfade clones both ends without shortening or changing source/target',{timeout:120000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'transition-clone-'));
 try{const {cfr}=await fixtures(root),asset=await probeAsset(cfr);asset.frameTiming=await detectCfr30(asset);const d=doc(asset),before=structuredClone(d),output=await render(d,path.join(root,'output'));assert.equal(output.frameCount,360);assert.equal(output.duration,12);assert.deepEqual(d,before);const rows=pixels(output.path);assert.equal(rows.length,360);const palette=Array.from({length:180},(_,n)=>rows[n<165?n:n+180]);let max=0,total=0;
  for(let n=165;n<195;n++){const p=(n-165)/30;for(let c=0;c<3;c++){const expected=palette[Math.min(n,179)][c]*(1-p)+palette[Math.max(n-180,0)][c]*p,error=Math.abs(rows[n][c]-expected);max=Math.max(max,error);total+=error;}}
  assert(max<=5,`actual endpoint clone RGB max=${max}, mean=${total/90}`);assert(total/90<1.8);assert(rows.every(rgb=>rgb.some(x=>x>10)),'black frames introduced');const script=await fs.readFile(path.join(root,'output','filter.txt'),'utf8');assert.match(script,/tpad=start=15:stop=0:start_mode=clone:stop_mode=clone/);assert.match(script,/tpad=start=0:stop=15:start_mode=clone:stop_mode=clone/);assert.match(script,/overlay=format=rgb/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('HTTP media registration persists only actually proved CFR30 metadata',{timeout:60000},async()=>{
 const {startServer}=await import('../apps/service/server.ts'),root=await fs.mkdtemp(path.join(os.tmpdir(),'transition-upload-')),paths=await fixtures(root),app=await startServer({root:path.join(root,'store'),port:0});
 try{for(const [kind,file]of Object.entries(paths)){const response=await fetch(app.origin+'/api/assets',{method:'POST',headers:{'x-editor-token':app.token,'x-filename':kind+'.mp4'},body:await fs.readFile(file)});assert.equal(response.status,201);const asset=await response.json();assert.equal(asset.frameTiming,kind==='cfr'?'cfr30':undefined);assert.deepEqual(asset.fps,r(30));}}
 finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});

test('duplicate actual upload upgrades legacy timing proof atomically and survives service reopen',{timeout:60000},async()=>{
 const {startServer}=await import('../apps/service/server.ts'),{Store}=await import('../apps/service/store.ts'),root=await fs.mkdtemp(path.join(os.tmpdir(),'transition-refresh-')),paths=await fixtures(root),data=path.join(root,'store');let app:Awaited<ReturnType<typeof startServer>>|undefined;
 try{const file=await fs.readFile(paths.cfr),upload=(name:string)=>fetch(app!.origin+'/api/assets',{method:'POST',headers:{'x-editor-token':app!.token,'x-filename':name},body:file});
  app=await startServer({root:data,port:0});const first=await(await upload('original.mp4')).json();assert.equal(first.frameTiming,'cfr30');await app.close();app=undefined;
  const assetFile=path.join(data,'assets.json'),records=JSON.parse(await fs.readFile(assetFile,'utf8'));delete records[0].frameTiming;await fs.writeFile(assetFile,JSON.stringify(records));
  app=await startServer({root:data,port:0});assert.equal(app.store.assets.get(first.id)!.frameTiming,undefined);const response=await upload('different-name.mp4');assert.equal(response.status,201);const upgraded=await response.json();assert.deepEqual(upgraded,{...records[0],frameTiming:'cfr30'});assert.equal(upgraded.path,first.path);await app.close();app=undefined;
  app=await startServer({root:data,port:0});assert.deepEqual(app.store.assets.get(first.id),upgraded);await app.close();app=undefined;
  const store=new Store(path.join(root,'untrusted'));await store.initialize();const supplied={...await probeAsset(paths.cfr),frameTiming:'cfr30' as const},untrusted=await store.addAsset(supplied);assert.equal(untrusted.frameTiming,undefined,'a caller-provided marker is not a measured registration proof');
  await assert.rejects(store.addAsset({...supplied,sha256:'b'.repeat(64)},{verifiedFrameTiming:'cfr30'}),/ASSET_FRAME_TIMING_IDENTITY_MISMATCH/);assert.equal(store.assets.get(supplied.id)!.frameTiming,undefined);
 }finally{await app?.close();await fs.rm(root,{recursive:true,force:true});}
});
