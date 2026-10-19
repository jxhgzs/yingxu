import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {captionScript} from './captions.ts';
import type {GlyphAnchor,GlyphLayouts} from './captions.ts';
import {prepareFonts} from './fonts.ts';
import {subtitleClock} from './subtitle-clock.ts';
import {ffmpeg} from './probe.ts';
import {runProcess} from './process.ts';
import {canRenderTextAnimationText} from '../../core/src/text-animation.ts';
import {check,defaultTransform} from '../../core/src/document.ts';
import {rational} from '../../core/src/time.ts';
import type {Rational} from '../../core/src/time.ts';
import type {Layer} from './graph.ts';

const completed=new Map<string,GlyphAnchor[]>();
/** Measured libass mask centres, including the original full line's advances. */
export async function prepareGlyphLayout(layer:Layer,canvas:{width:number;height:number},directory:string,signal?:AbortSignal):Promise<GlyphAnchor[]>{
 const text=layer.clip.text!,count=text.content.length,frameBytes=canvas.width*canvas.height;
 check(canRenderTextAnimationText(text.content)&&count<=128,'TEXT_GLYPH_LAYOUT_TEXT_UNSUPPORTED');
 check(frameBytes*(count+1)<=268435456,'TEXT_GLYPH_LAYOUT_SIZE_LIMIT');
 if(signal?.aborted)throw Error('JOB_CANCELLED');
 const key=createHash('sha256').update(JSON.stringify({canvas,text:text.content,font:text.font,size:text.size,lineHeight:text.lineHeight})).digest('hex');
 const cached=completed.get(key);if(cached){completed.delete(key);completed.set(key,cached);return structuredClone(cached);}
 const temporary=path.join(directory,'.glyph-'+randomUUID());await fs.mkdir(temporary,{recursive:true});
 try{
  const fonts=await prepareFonts([text.font],temporary),fps=rational(10),events:string[]=[];let header='';
  for(let i=0;i<=count;i++){
   const clip={...structuredClone(layer.clip),id:'glyph-layout',target:{start:rational(i,10),duration:rational(1,10)},transform:defaultTransform(),text:{...text,color:'#ffffff',outline:0,shadow:0}};
   delete clip.animations;delete clip.textAnimations;
   const script=captionScript([{...layer,clip}],canvas,fps,i<count?{visibleGlyph:i}:{}),marker=script.indexOf('Dialogue:');
   check(marker>=0,'TEXT_GLYPH_LAYOUT_EMPTY');header=script.slice(0,marker);events.push(script.slice(marker));
  }
  await fs.writeFile(path.join(temporary,'glyph.ass'),header+events.join(''));
  const clock=subtitleClock(fps);
  await runProcess(ffmpeg(),['-v','error','-nostdin','-y','-threads','1','-filter_complex_threads','1','-f','lavfi','-i',`color=c=black:s=${canvas.width}x${canvas.height}:r=10,format=rgba`,'-vf',`${clock.before},subtitles=filename=glyph.ass${fonts?':fontsdir=fonts':''},${clock.after}`,'-frames:v',String(count+1),'-fps_mode','passthrough','-pix_fmt','gray','-f','rawvideo','glyph.gray'],{cwd:temporary,signal,timeout:60000});
  const file=await fs.open(path.join(temporary,'glyph.gray'),'r'),frame=Buffer.alloc(frameBytes),coverage=new Uint8Array(frameBytes),anchors:GlyphAnchor[]=[],metrics:{x0:number;y0:number;x1:number;y1:number;mass:number;mx:number;my:number}[]=[];
  try{
   check((await file.stat()).size===frameBytes*(count+1),'TEXT_GLYPH_LAYOUT_PIXELS_INVALID');
   for(let i=0;i<=count;i++){
    if(signal?.aborted)throw Error('JOB_CANCELLED');let offset=0;
    while(offset<frameBytes){const {bytesRead}=await file.read(frame,offset,frameBytes-offset,i*frameBytes+offset);check(bytesRead>0,'TEXT_GLYPH_LAYOUT_PIXELS_INVALID');offset+=bytesRead;}
    if(i===count){
     for(let p=0;p<frameBytes;p++)check(!frame[p]||coverage[p]===1,'TEXT_GLYPH_LAYOUT_SHAPING_UNVERIFIED');
     // Style-run boundaries can change libass edge coverage by a subpixel.
     // Compare measured geometry/mass against the original line, not AA codes.
     for(const m of metrics){let mass=0,mx=0,my=0;
      for(let y=m.y0;y<=m.y1;y++)for(let x=m.x0;x<=m.x1;x++){const v=frame[y*canvas.width+x];mass+=v;mx+=x*v;my+=y*v;}
      check(mass>0&&Math.abs(mass/m.mass-1)<.01&&Math.abs(mx/mass-m.mx/m.mass)<.25&&Math.abs(my/mass-m.my/m.mass)<.25,'TEXT_GLYPH_LAYOUT_SHAPING_UNVERIFIED');
     }
     continue;
    }
    let x0=canvas.width,y0=canvas.height,x1=-1,y1=-1,sx0=canvas.width,sy0=canvas.height,sx1=-1,sy1=-1,mass=0,mx=0,my=0;
    for(let p=0;p<frameBytes;p++){
     if(frame[p]){const x=p%canvas.width,y=Math.floor(p/canvas.width);sx0=Math.min(sx0,x);sx1=Math.max(sx1,x);sy0=Math.min(sy0,y);sy1=Math.max(sy1,y);mass+=frame[p];mx+=x*frame[p];my+=y*frame[p];}
     if(frame[p]>127){const x=p%canvas.width,y=Math.floor(p/canvas.width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    }
    check(text.content[i]===' '||text.content[i]==='\n'||mass>0&&x1>=0,'TEXT_GLYPH_LAYOUT_SHAPING_UNVERIFIED');
    if(mass){sx0=Math.max(0,sx0-1);sy0=Math.max(0,sy0-1);sx1=Math.min(canvas.width-1,sx1+1);sy1=Math.min(canvas.height-1,sy1+1);metrics.push({x0:sx0,y0:sy0,x1:sx1,y1:sy1,mass,mx,my});for(let y=sy0;y<=sy1;y++)for(let x=sx0;x<=sx1;x++)coverage[y*canvas.width+x]++;}
    anchors.push(x1<0?null:{x:(x0+x1)/2,y:(y0+y1)/2});
   }
  }finally{await file.close();}
  completed.set(key,anchors);while(completed.size>64)completed.delete(completed.keys().next().value!);return structuredClone(anchors);
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}

/** Scalar preview, batched preview and export all enter through this authority. */
export async function renderCaptionScript(layers:Layer[],canvas:{width:number;height:number},fps:Rational,directory:string,signal?:AbortSignal):Promise<{script:string;fonts:boolean}>{
 const fonts=await prepareFonts(layers.flatMap(l=>l.clip.text?[l.clip.text.font]:[]),directory),glyphLayouts:GlyphLayouts=new Map();
 for(const layer of layers)if(layer.clip.textAnimations?.some(a=>a.kind==='sway'))glyphLayouts.set(layer.clip.id,await prepareGlyphLayout(layer,canvas,directory,signal));
 return {script:captionScript(layers,canvas,fps,{glyphLayouts}),fonts};
}
