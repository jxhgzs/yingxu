import fs from 'node:fs/promises';
import path from 'node:path';
import {captionScript} from './captions.ts';
import {subtitleClock} from './subtitle-clock.ts';
import {prepareFonts} from './fonts.ts';
import {ffmpeg} from './probe.ts';
import {runProcess} from './process.ts';
import {rational} from '../../core/src/time.ts';
import type {Rational} from '../../core/src/time.ts';
import {check,defaultTransform} from '../../core/src/document.ts';
import type {Layer} from './graph.ts';

/** Render static, neutral or exact-frame ASS with the same export layout and fonts. */
export async function rasterText(layer:Layer,canvas:{width:number;height:number},directory:string,options:{signal?:AbortSignal;mode?:'neutral'|'frame';frame?:number;fps?:Rational}={}){
 check(layer.asset.kind==='text'&&!!layer.clip.text,'TEXT_RASTER_CLIP_REQUIRED');
 check((options.mode!==undefined||!layer.clip.animations?.some(a=>a.property!=='volume')&&!layer.clip.textAnimations?.length)&&!layer.clip.speedCurve,'TEXT_RASTER_ANIMATION_UNSUPPORTED');
 check(!layer.clip.transform?.flipX&&!layer.clip.transform?.flipY,'TEXT_FLIP_UNSUPPORTED');
 check(Number.isInteger(canvas.width)&&Number.isInteger(canvas.height)&&canvas.width>=2&&canvas.height>=2&&canvas.width*canvas.height<=33554432,'TEXT_RASTER_SIZE_LIMIT');
 await fs.mkdir(directory,{recursive:true});
 const fonts=await prepareFonts([layer.clip.text!.font],directory),clip={...structuredClone(layer.clip),target:{start:rational(0),duration:rational(1)}};
 if(options.mode==='neutral'){
  clip.transform=defaultTransform();delete clip.textAnimations;
  // Animated ASS uses an explicit alpha override for all glyph components.
  // Retain that semantics while removing the original source-clock transform.
  clip.animations=[{property:'opacity',points:[{id:'neutral-alpha',time:rational(0),value:1,interpolation:'hold'}]}];
 }
 const fps=options.mode==='frame'?options.fps!:rational(30);
 check(options.mode!=='frame'||Number.isSafeInteger(options.frame)&&options.frame!>=0&&!!options.fps,'INVALID_TEXT_RASTER_FRAME');
 await fs.writeFile(path.join(directory,'caption.ass'),captionScript(options.mode==='frame'?[layer]:[{...layer,clip}],canvas,fps));
 // libass' alpha-plane blending is not the same coverage used by its RGB planes.
 // Two opaque backgrounds recover the actual composite operator, including overlapping
 // glyph/outline/shadow components. This avoids dark antialiasing from double premultiply.
 const clock=subtitleClock(fps,options.mode==='frame'?options.frame!:0),filter=`${clock.before},subtitles=filename=caption.ass${fonts?':fontsdir=fonts':''},${clock.after}`;
 const args=['-hide_banner','-loglevel','warning','-nostdin','-y','-threads','1','-filter_complex_threads','1'];
 for(const background of ['black','white'])args.push('-f','lavfi','-i',`color=c=${background}:s=${canvas.width}x${canvas.height}:r=${fps.numerator}/${fps.denominator},format=rgba`);
 args.push('-filter_complex',`[0:v]${filter}[black];[1:v]${filter}[white]`);
 for(const background of ['black','white'])args.push('-map',`[${background}]`,'-frames:v','1','-pix_fmt','rgba','-f','rawvideo',background+'.rgba');
 const result=await runProcess(ffmpeg(),args,{cwd:directory,signal:options.signal,timeout:30000});
 const black=await fs.readFile(path.join(directory,'black.rgba')),white=await fs.readFile(path.join(directory,'white.rgba'));
 check(black.length===canvas.width*canvas.height*4&&white.length===black.length,'TEXT_RASTER_PIXELS_INVALID');
 const pixels=Buffer.alloc(black.length);
 for(let i=0;i<black.length;i+=4){
  const alpha=255-Math.round(((white[i]-black[i])+(white[i+1]-black[i+1])+(white[i+2]-black[i+2]))/3);
  pixels[i+3]=Math.max(0,Math.min(255,alpha));
  if(alpha>0)for(let c=0;c<3;c++)pixels[i+c]=Math.max(0,Math.min(255,Math.round(black[i+c]*255/alpha)));
 }
 await fs.writeFile(path.join(directory,'straight.rgba'),pixels);
 const encoded=await runProcess(ffmpeg(),['-hide_banner','-loglevel','warning','-nostdin','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${canvas.width}x${canvas.height}`,'-i','straight.rgba','-frames:v','1','-c:v','png','-threads','1','-update','1','caption.png'],{cwd:directory,signal:options.signal,timeout:30000});
 await fs.writeFile(path.join(directory,'ffmpeg.log'),result.stderr+encoded.stderr);
 return {path:path.join(directory,'caption.png'),width:canvas.width,height:canvas.height};
}
