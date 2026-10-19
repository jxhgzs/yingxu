import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {rasterText} from '../packages/media/src/text-raster.ts';
import {captionScript} from '../packages/media/src/captions.ts';
import {subtitleClock} from '../packages/media/src/subtitle-clock.ts';
import {runProcess} from '../packages/media/src/process.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
import {renderGraph} from '../packages/media/src/graph.ts';
import {Store} from '../apps/service/store.ts';
import {TextRasters} from '../apps/service/text-raster.ts';
import {createPreviewPlan,previewFrame,textRasterMode} from '../apps/editor/src/preview/plan.ts';
function doc(){const d=emptyDocument();d.canvas={width:320,height:180};d.assets.push({id:'txt',kind:'text',path:'',duration:rational(3600)});d.tracks[2].clips.push({id:'caption',materialId:'txt',source:{start:rational(1),duration:rational(4)},target:{start:rational(2),duration:rational(2)},speed:rational(2),editableTiming:true,transform:defaultTransform(),text:{content:'中文 Alpha\n第二行',font:'Source Han Sans SC Medium',color:'#f1b874',size:25,outline:0,shadow:0,lineHeight:40},animations:[{property:'opacity',points:[{id:'a',time:rational(1),value:.25,interpolation:'linear'},{id:'b',time:rational(5),value:.75,interpolation:'linear'}]}]});return d;}
async function pngPixels(file:string,root:string){await runProcess(ffmpeg(),['-v','error','-y','-i',file,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','decoded.rgba'],{cwd:root});return fs.readFile(path.join(root,'decoded.rgba'));}
async function direct(layer:any,root:string,background:string,frame:number,fps=rational(30)){const clock=subtitleClock(fps);await fs.writeFile(path.join(root,'direct.ass'),captionScript([layer],{width:320,height:180},fps));await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i',`color=c=${background}:s=320x180:r=${fps.numerator}/${fps.denominator},format=rgba`,'-vf',`${clock.before},subtitles=filename=direct.ass:fontsdir=fonts,${clock.after},select=eq(n\\,${frame})`,'-frames:v','1','-fps_mode','passthrough','-pix_fmt','rgba','-f','rawvideo','direct.rgba'],{cwd:root});return fs.readFile(path.join(root,'direct.rgba'));}
function difference(rgba:Buffer,actual:Buffer,opacity=1){let max=0,total=0;for(let i=0;i<rgba.length;i+=4)for(let c=0;c<3;c++){const a=rgba[i+3]/255*opacity,expected=Math.round(rgba[i+c]*a+actual[c]*(1-a)),delta=Math.abs(expected-actual[i+c]);max=Math.max(max,delta);total+=delta;}return {max,mean:total/(rgba.length/4*3)};}

test('neutral unadorned glyph uses one quantized source-clock alpha across three backgrounds',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-neutral-'));
 try{const d=doc(),plan=createPreviewPlan(d,{texturesAvailable:true}).plan!,layer=renderGraph(d).layers[0];assert.equal(textRasterMode(layer.clip),'neutral');const rendered=await rasterText(layer,d.canvas,root,{mode:'neutral'}),rgba=await pngPixels(rendered.path,root);
  for(const frame of [60,75,105]){const opacity=previewFrame(plan,rational(frame,30)).layers[0].transform.opacity,quantized=1-Math.round((1-opacity)*255)/255;
   for(const bg of ['0x2577b9','0xf5e0a3','0x190d24']){const actual=await direct(layer,root,bg,frame),error=difference(rgba,actual,quantized);assert(error.max<=2,JSON.stringify({frame,bg,error}));assert(error.mean<.08);assert(difference(rgba,actual,quantized*quantized).max>3,'second alpha application should be visibly wrong');}
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('exact frame rasters retain original target start, 2x source-clock geometry and decorated alpha',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-frame-'));
 try{const d=doc(),clip=d.tracks[2].clips[0];clip.text!.outline=1.3;clip.text!.shadow=1;for(const [property,a,b]of [['x',-20,25],['y',10,-8],['scale',.75,1.1],['rotation',-12,15]] as const)clip.animations!.push({property,points:[{id:'a',time:rational(1),value:a,interpolation:'linear'},{id:'b',time:rational(5),value:b,interpolation:'linear'}]});assert.equal(textRasterMode(clip),'frame');const layer=renderGraph(d).layers[0];
  for(const frame of [60,75,105]){const directory=path.join(root,String(frame)),rendered=await rasterText(layer,d.canvas,directory,{mode:'frame',frame,fps:d.fps}),rgba=await pngPixels(rendered.path,directory);
   for(const bg of ['0x2577b9','0xf5e0a3','0x190d24']){const actual=await direct(layer,directory,bg,frame),error=difference(rgba,actual);assert(error.max<=3,JSON.stringify({frame,bg,error}));assert(error.mean<.08);}
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('animation raster modes validate frames, freeze revision and separate neutral/static/frame cache identities',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-frame-service-')),store=new Store(root);await store.initialize();const state=await store.create(doc()),rasters=new TextRasters(store,{engine:'frame-font-code'});
 try{for(const body of [{mode:'unknown'},{mode:'frame'},{mode:'neutral',frame:60},{frame:60},{mode:'frame',frame:-1},{mode:'frame',frame:1.5}])await assert.rejects(rasters.request(state.id,{revision:0,clipId:'caption',...body} as any),/INVALID_TEXT_TEXTURE_REQUEST/);
  for(const frame of [59,120])await assert.rejects(rasters.request(state.id,{revision:0,clipId:'caption',mode:'frame',frame}),/FRAME_OUTSIDE_CLIP/);
  const neutral=await rasters.request(state.id,{revision:0,clipId:'caption',mode:'neutral'});assert.equal(neutral.mode,'neutral');assert.equal(neutral.frame,undefined);
  const first=await rasters.request(state.id,{revision:0,clipId:'caption',mode:'frame',frame:60}),again=await rasters.request(state.id,{revision:0,clipId:'caption',mode:'frame',frame:60}),next=await rasters.request(state.id,{revision:0,clipId:'caption',mode:'frame',frame:61});assert.equal(first.mode,'frame');assert.equal(first.frame,60);assert.deepEqual(first,again);assert.notEqual(first.key,next.key);assert.notEqual(first.key,neutral.key);
  const plain=doc();delete plain.tracks[2].clips[0].animations;const p=await store.create(plain),staticResult=await rasters.request(p.id,{revision:0,clipId:'caption'});assert.notEqual(staticResult.key,neutral.key);assert.equal(staticResult.mode,undefined);
  const held=doc();held.tracks[2].clips[0].animations![0].points[0].interpolation='hold';const h=await store.create(held),h1=await rasters.request(h.id,{revision:0,clipId:'caption',mode:'frame',frame:60}),h2=await rasters.request(h.id,{revision:0,clipId:'caption',mode:'frame',frame:61});assert.equal(h1.key,h2.key,'identical evaluated style reuses PNG across distinct target frames');assert.equal(h2.frame,61);
 }finally{await rasters.shutdown();await fs.rm(root,{recursive:true,force:true});}
});

test('active frame requests cancelled or superseded during real libass rendering publish no stale file',{timeout:60000},async()=>{
 for(const action of ['cancel','revision'] as const){const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-frame-race-')),store=new Store(root);await store.initialize();const d=doc();d.canvas={width:1920,height:1080};d.tracks[2].clips[0].text!.content='核对真实取消 '.repeat(150);const state=await store.create(d),rasters=new TextRasters(store,{engine:'cancel-frame'}),controller=new AbortController();
  try{const task=rasters.request(state.id,{revision:0,clipId:'caption',mode:'frame',frame:75},controller.signal);void task.catch(()=>{});const cache=path.join(root,'text-renders'),deadline=Date.now()+10000;let active=false;
   while(Date.now()<deadline){for(const entry of await fs.readdir(cache).catch(()=>[]))if(entry.startsWith('.')){if(await fs.stat(path.join(cache,entry,'black.rgba')).catch(()=>undefined)){active=true;break;}}if(active)break;await new Promise(r=>setTimeout(r,5));}
   assert(active,'no actual libass subprocess output observed');if(action==='cancel')controller.abort();else store.get(state.id).revision++;
   await assert.rejects(task,action==='cancel'?/Aborted/:/REVISION_CONFLICT/);assert.deepEqual(await fs.readdir(cache),[]);
  }finally{await rasters.shutdown();await fs.rm(root,{recursive:true,force:true});}
 }
});

test('long or oversized exact text animation keeps an explicit offline fallback while short opacity stays GPU eligible',()=>{
 const d=doc();assert(createPreviewPlan(d,{texturesAvailable:true}).support.supported);d.tracks[2].clips[0].text!.font='Unverified font';assert.equal(textRasterMode(d.tracks[2].clips[0]),'frame');d.tracks[2].clips[0].text!.font='Source Han Sans SC Medium';d.tracks[2].clips[0].text!.outline=1;assert.equal(textRasterMode(d.tracks[2].clips[0]),'frame');assert(createPreviewPlan(d,{texturesAvailable:true}).support.supported);
 d.canvas={width:3840,height:2160};assert(createPreviewPlan(d,{texturesAvailable:true}).support.reasons.some(r=>r.code==='TEXT_FRAME_RASTER_LIMIT'));
 d.canvas={width:320,height:180};d.tracks[2].clips[0].source.duration=rational(22);d.tracks[2].clips[0].target.duration=rational(11);assert(createPreviewPlan(d,{texturesAvailable:true}).support.reasons.some(r=>r.code==='TEXT_FRAME_RASTER_LIMIT'));
});

// The raster input timebase is forced to 1/fps before an integer frame PTS shift.
test('exact text frame PTS keeps NTSC and 60fps clocks rather than rounding through decimal seconds',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-frame-rate-'));
 try{for(const fps of [rational(30000,1001),rational(60)]){const d=doc();d.fps=fps;const layer=renderGraph(d).layers[0],frame=fps.numerator==='60'?155:75,dir=path.join(root,fps.numerator),raster=await rasterText(layer,d.canvas,dir,{mode:'frame',frame,fps}),rgba=await pngPixels(raster.path,dir),actual=await direct(layer,dir,'0x2577b9',frame,fps),error=difference(rgba,actual);assert(error.max<=3,JSON.stringify({fps,error}));assert(error.mean<.08);}}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('native fade neutral rasters exclude preset alpha while typewriter stays exact-frame',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-preset-raster-'));
 try{const d=doc(),clip=d.tracks[2].clips[0];delete clip.animations;clip.textAnimations=[{phase:'in',kind:'fade',duration:rational(1)}];const layer=renderGraph(d).layers[0],plan=createPreviewPlan(d,{texturesAvailable:true}).plan!;assert.equal(textRasterMode(clip),'neutral');const raster=await rasterText(layer,d.canvas,root,{mode:'neutral'}),rgba=await pngPixels(raster.path,root);assert(rgba.some((x,i)=>i%4===3&&x>100),'neutral glyph baked the zero alpha at start');
  for(const frame of [60,65,75]){const actual=await direct(layer,root,'0x2577b9',frame),opacity=previewFrame(plan,rational(frame,30)).layers[0].transform.opacity,error=difference(rgba,actual,opacity);assert(error.max<=2,JSON.stringify({frame,error}));assert(error.mean<.08);}
  clip.textAnimations=[{phase:'in',kind:'typewriter',duration:rational(1)}];assert.equal(textRasterMode(clip),'frame');const typeLayer=renderGraph(d).layers[0];for(const frame of [60,65,75]){const dir=path.join(root,String(frame)),image=await rasterText(typeLayer,d.canvas,dir,{mode:'frame',frame,fps:d.fps}),pixels=await pngPixels(image.path,dir),actual=await direct(typeLayer,dir,'0xf5e0a3',frame),error=difference(pixels,actual);assert(error.max<=3,JSON.stringify({frame,error}));assert(error.mean<.08);}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('HTTP animation texture modes preserve metadata and reject invalid or inactive frame requests',{timeout:60000},async()=>{
 const {startServer}=await import('../apps/service/server.ts'),root=await fs.mkdtemp(path.join(os.tmpdir(),'text-frame-http-')),app=await startServer({root,port:0});
 try{const state=await app.store.create(doc()),post=(body:unknown)=>fetch(app.origin+`/api/projects/${state.id}/textures`,{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':app.token},body:JSON.stringify(body)});
  for(const body of [{revision:0,clipId:'caption',mode:'frame'},{revision:0,clipId:'caption',mode:'neutral',frame:60},{revision:0,clipId:'caption',mode:'frame',frame:60,extra:true}]){const result=await post(body);assert.equal(result.status,400);assert.equal((await result.json()).error,'INVALID_TEXT_TEXTURE_REQUEST');}
  const outside=await post({revision:0,clipId:'caption',mode:'frame',frame:0});assert.equal(outside.status,400);assert.equal((await outside.json()).error,'TEXT_RASTER_FRAME_OUTSIDE_CLIP');
  const response=await post({revision:0,clipId:'caption',mode:'frame',frame:75});assert.equal(response.status,200);const frame=await response.json();assert.equal(frame.clipId,'caption');assert.equal(frame.revision,0);assert.equal(frame.mode,'frame');assert.equal(frame.frame,75);const png=await fetch(app.origin+frame.url);assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/png');
  const neutral=await post({revision:0,clipId:'caption',mode:'neutral'});assert.equal(neutral.status,200);const texture=await neutral.json();assert.equal(texture.mode,'neutral');assert.equal(texture.frame,undefined);assert.notEqual(texture.key,frame.key);
 }finally{await app.close();await fs.rm(root,{recursive:true,force:true});}
});

test('flash and combined phases use one neutral glyph with shared quantized alpha on three backgrounds',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'text-loop-raster-'));
 try{
  const d=doc(),clip=d.tracks[2].clips[0];delete clip.animations;
  clip.textAnimations=[{phase:'in',kind:'fade',duration:rational(3,10)},{phase:'out',kind:'fade',duration:rational(2,5)},{phase:'loop',kind:'flash',duration:rational(1,2)}];
  assert.equal(textRasterMode(clip),'neutral');const plan=createPreviewPlan(d,{texturesAvailable:true}).plan!,layer=renderGraph(d).layers[0];
  const raster=await rasterText(layer,d.canvas,root,{mode:'neutral'}),rgba=await pngPixels(raster.path,root);
  assert(rgba.some((x,i)=>i%4===3&&x>100),'neutral glyph must not bake the zero-alpha entrance');
  for(const frame of [60,65,69,70,75,84,108,111,114])for(const bg of ['0x2577b9','0xf5e0a3','0x190d24']){
   const actual=await direct(layer,root,bg,frame),opacity=previewFrame(plan,rational(frame,30)).layers[0].transform.opacity,error=difference(rgba,actual,opacity);
   assert(error.max<=2,JSON.stringify({frame,bg,error}));assert(error.mean<.08);
  }
  clip.text!.outline=1;assert.equal(textRasterMode(clip),'frame');clip.text!.outline=0;clip.text!.font='Arial';assert.equal(textRasterMode(clip),'frame');
  clip.text!.font='Source Han Sans SC Medium';clip.textAnimations=[{phase:'loop',kind:'flash',duration:rational(1,2)}];clip.source.duration=rational(60);clip.target.duration=rational(30);
  assert.equal(textRasterMode(clip),'neutral');assert(createPreviewPlan(d,{texturesAvailable:true}).support.supported,'neutral looping text should not inherit the 300 exact-frame limit');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
