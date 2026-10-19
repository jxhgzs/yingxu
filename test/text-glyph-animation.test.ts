import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational as r} from '../packages/core/src/time.ts';
import {textAnimationGlyphState,validateTextAnimations} from '../packages/core/src/text-animation.ts';
import {renderGraph} from '../packages/media/src/graph.ts';
import {captionScript} from '../packages/media/src/captions.ts';
import {prepareGlyphLayout,renderCaptionScript} from '../packages/media/src/glyph-layout.ts';
import {rasterText} from '../packages/media/src/text-raster.ts';
import {rasterTextFrames} from '../packages/media/src/text-raster-batch.ts';
import {runProcess} from '../packages/media/src/process.ts';
import {ffmpeg} from '../packages/media/src/probe.ts';
function document(text='文字动画对照'){
 const d=emptyDocument();d.canvas={width:320,height:180};d.fps=r(30);d.assets=[{id:'text',path:'',kind:'text',duration:r(4)}];
 d.tracks=[{id:'t',kind:'text',clips:[{id:'c',materialId:'text',source:{start:r(0),duration:r(4)},target:{start:r(0),duration:r(4)},speed:r(1),editableTiming:true,transform:defaultTransform(),text:{content:text,font:'Source Han Sans SC Medium',size:32,color:'#ffffff',outline:0,shadow:0},textAnimations:[{phase:'loop',kind:'sway',duration:r(1,2)}]}]}];return d;
}
test('sway turns alternate original character entries at the observed half-cycle',()=>{
 const d=document(),a=d.tracks[0].clips[0].textAnimations!;validateTextAnimations(a,r(4));
 for(let n=0;n<120;n++)assert.equal(textAnimationGlyphState(a,r(n,30),r(4)).sway,n%15>=8);
 assert.equal(textAnimationGlyphState(a,r(1,4),r(4)).sway,true);
 assert.equal(textAnimationGlyphState(a,r(1,2),r(4)).sway,false);
 assert.deepEqual(textAnimationGlyphState(undefined,r(1),r(4)),{sway:false});
 assert.throws(()=>validateTextAnimations([{...a[0],phase:'in'}],r(4)),/KIND_UNVERIFIED/);
 const layer=renderGraph(d).layers[0];assert.throws(()=>captionScript([layer],d.canvas,d.fps),/TEXT_GLYPH_LAYOUT_REQUIRED/);
});
test('sway keeps actual native phase boundaries across single and three separately exported combinations',async()=>{
 const records=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-text-presets-v9/sway-native-clock.json',import.meta.url),'utf8'));let count=0;
 for(const [name,record]of Object.entries(records)as [string,any][]){
  const d=document(),a=d.tracks[0].clips[0].textAnimations!;
  if(name!=='single'){a[0].duration=name==='combo'?r(7,10):r(1);a.push({phase:'in',kind:'zoom-in',duration:name==='combohalf'?r(1,2):r(3,10)},{phase:'out',kind:'fade',duration:r(2,5)});}
  const first=name==='single'?0:name==='combohalf'?15:9;
  for(const row of record.rows)if(row.frame>=first){assert.equal(textAnimationGlyphState(a,r(row.frame,30),r(4)).sway,row.observedSway,`${name} frame ${row.frame}`);count++;}
 }
 assert.equal(count,447);
});
test('each rotated ASS event retains the full line and has an independently measured glyph origin',()=>{
 const d=document('A B中文\nC'),layer=renderGraph(d).layers[0],anchors=[{x:110,y:80},null,{x:130,y:80},{x:150,y:80},{x:170,y:80},null,{x:160,y:110}];
 const s=captionScript([layer],d.canvas,d.fps,{glyphLayouts:new Map([['c',anchors]])}),events=s.split('\n').filter(l=>l.startsWith('Dialogue:'));
 const active=events.filter(l=>l.includes('0:00:00.26,0:00:00.30'));assert.equal(active.length,5);
 assert.match(active[0],/\\org\(110,80\).*\\frz-5/);assert.match(active[1],/\\org\(130,80\).*\\frz-5/);
 assert.match(active[2],/\\org\(150,80\).*\\frz5/);assert.match(active[4],/\\org\(160,110\).*\\frz-5/);
 for(const event of active)assert(event.replace(/\{[^}]*\}/g,'').endsWith('A B中文\\NC'));
});
test('actual glyph layout preserves measured line placement, invisible entries and bounded cache copies',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'glyph-layout-'));
 try{
  const d=document('AB C中文\nD EFG'),layer=renderGraph(d).layers[0],a=await prepareGlyphLayout(layer,d.canvas,root);
  assert.equal(a.length,12);for(const i of [2,6,8])assert.equal(a[i],null);
  assert(a[0]!.x<a[1]!.x&&a[3]!.x<a[4]!.x&&a[4]!.x<a[5]!.x);assert(a[7]!.y>a[0]!.y);
  const original=a[0]!.x;a[0]!.x=-999;assert.equal((await prepareGlyphLayout(layer,d.canvas,root))[0]!.x,original);
  const {script}=await renderCaptionScript([layer],d.canvas,d.fps,root);assert(script.includes('\\org('));
  const invalid=document('👩‍💻');await assert.rejects(prepareGlyphLayout({...layer,clip:invalid.tracks[0].clips[0]},d.canvas,root),/TEXT_UNSUPPORTED/);
  const large=document('字'.repeat(129));await assert.rejects(prepareGlyphLayout({...layer,clip:large.tracks[0].clips[0]},d.canvas,root),/TEXT_UNSUPPORTED/);
  const tiny=document('字');tiny.tracks[0].clips[0].text!.size=1;await assert.rejects(prepareGlyphLayout({...layer,clip:tiny.tracks[0].clips[0]},d.canvas,root),/SHAPING_UNVERIFIED/);
  const controller=new AbortController();controller.abort();await assert.rejects(prepareGlyphLayout({...layer,clip:{...layer.clip,text:{...layer.clip.text!,content:'新字'}}},d.canvas,root,controller.signal),/CANCELLED/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('sway scalar and bounded batch textures are byte-equivalent at neutral, rotated and reset phases',{timeout:60000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'glyph-texture-'));
 try{
  const d=document(),layer=renderGraph(d).layers[0],frames=[0,7,8,14,15],batch=await rasterTextFrames(layer,d.canvas,path.join(root,'batch'),{frames,fps:d.fps});
  for(const image of batch){const scalar=await rasterText(layer,d.canvas,path.join(root,'scalar-'+image.frame),{mode:'frame',frame:image.frame,fps:d.fps});assert.deepEqual(await fs.readFile(image.path),await fs.readFile(scalar.path));}
  assert.deepEqual(await fs.readFile(batch[0].path),await fs.readFile(batch[4].path));assert.notDeepEqual(await fs.readFile(batch[0].path),await fs.readFile(batch[2].path));
  const decode=async(file:string,name:string)=>{const output=path.join(root,name);await runProcess(ffmpeg(),['-v','error','-y','-i',file,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo',output]);const rgba=await fs.readFile(output);return Float64Array.from({length:320*180},(_,i)=>rgba[i*4]*rgba[i*4+3]/255);};
  const base=await decode(batch[0].path,'base.rgba'),actual=await decode(batch[2].path,'rotated.rgba'),anchors=await prepareGlyphLayout(layer,d.canvas,root);
  for(let glyph=0;glyph<6;glyph++){
   const pivot=anchors[glyph]!,left=glyph?Math.ceil((anchors[glyph-1]!.x+pivot.x)/2):0,right=glyph<5?Math.ceil((pivot.x+anchors[glyph+1]!.x)/2):320;
   const sample=(x:number,y:number)=>{if(x<left||x>=right-1||y<0||y>=179)return 0;const ix=Math.floor(x),iy=Math.floor(y),a=x-ix,b=y-iy;return base[iy*320+ix]*(1-a)*(1-b)+base[iy*320+ix+1]*a*(1-b)+base[(iy+1)*320+ix]*(1-a)*b+base[(iy+1)*320+ix+1]*a*b;};
   const error=(sign:number)=>{const angle=sign*(glyph%2===0?5:-5)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);let sum=0;for(let y=0;y<180;y++)for(let x=left;x<right;x++){const dx=x-pivot.x,dy=y-pivot.y,expected=sample(pivot.x+c*dx+s*dy,pivot.y-s*dx+c*dy);sum+=(expected-actual[y*320+x])**2;}return sum;};
   assert(error(1)<error(-1)*.45,`glyph ${glyph}: independent baseline-image rotation must favour measured native direction and own glyph centre`);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
