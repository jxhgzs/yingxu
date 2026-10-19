import fs from 'node:fs/promises';
import path from 'node:path';
import {renderCaptionScript} from './glyph-layout.ts';
import {subtitleClock} from './subtitle-clock.ts';
import {renderTextFramePipeline} from './text-raster-process.ts';
import {ffmpeg} from './probe.ts';
import {rational,div,compare,add} from '../../core/src/time.ts';
import type {Rational} from '../../core/src/time.ts';
import {check} from '../../core/src/document.ts';
import type {Layer} from './graph.ts';
/** A bounded exact-frame window. ASS, clocks, alpha recovery and PNG encoding match rasterText. */
export async function rasterTextFrames(layer:Layer,canvas:{width:number;height:number},directory:string,options:{frames:readonly number[];fps:Rational;signal?:AbortSignal}){
 const {frames,fps}=options;check(layer.asset.kind==='text'&&!!layer.clip.text&&!layer.clip.speedCurve,'TEXT_RASTER_CLIP_REQUIRED');
 check(!layer.clip.transform?.flipX&&!layer.clip.transform?.flipY,'TEXT_FLIP_UNSUPPORTED');
 check(Array.isArray(frames)&&frames.length>0&&frames.length<=32&&frames.every((f,i)=>Number.isSafeInteger(f)&&f>=0&&(!i||f>frames[i-1]))&&frames.at(-1)!-frames[0]<300,'INVALID_TEXT_RASTER_BATCH');
 const frameBytes=canvas.width*canvas.height*4;
 check(Number.isInteger(canvas.width)&&Number.isInteger(canvas.height)&&canvas.width>=2&&canvas.height>=2&&canvas.width*canvas.height<=1920*1080&&frameBytes*frames.length<=128*1024*1024,'TEXT_RASTER_BATCH_SIZE_LIMIT');
 for(const frame of frames){const at=div(rational(frame),fps);check(compare(at,layer.clip.target.start)>=0&&compare(at,add(layer.clip.target.start,layer.clip.target.duration))<0,'TEXT_RASTER_FRAME_OUTSIDE_CLIP');}
 if(options.signal?.aborted)throw Error('JOB_CANCELLED');await fs.mkdir(directory,{recursive:true});
 const {script,fonts}=await renderCaptionScript([layer],canvas,fps,directory,options.signal);await fs.writeFile(path.join(directory,'caption.ass'),script);
 const clock=subtitleClock(fps,frames[0]),selected=frames.map(frame=>`eq(n\\,${frame-frames[0]})`).join('+'),filter=`${clock.before},subtitles=filename=caption.ass${fonts?':fontsdir=fonts':''},${clock.after},select='${selected}'`;
 const args=['-hide_banner','-loglevel','warning','-nostdin','-y','-threads','1','-filter_complex_threads','1'];
 for(const background of ['black','white'])args.push('-f','lavfi','-i',`color=c=${background}:s=${canvas.width}x${canvas.height}:r=${fps.numerator}/${fps.denominator},format=rgba`);
 args.push('-filter_complex',`[0:v]${filter}[black];[1:v]${filter}[white];[black][white]vstack=inputs=2,format=rgba[paired]`,'-map','[paired]','-frames:v',String(frames.length),'-fps_mode','passthrough','-pix_fmt','rgba','-f','rawvideo','pipe:1');
 const encoded=await renderTextFramePipeline(ffmpeg(),args,['-hide_banner','-loglevel','warning','-nostdin','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${canvas.width}x${canvas.height}`,'-i','pipe:0','-frames:v',String(frames.length),'-c:v','png','-threads','1','-start_number','0','-f','image2','caption-%03d.png'],{cwd:directory,signal:options.signal,timeout:60000,frameBytes,frames:frames.length});
 await fs.writeFile(path.join(directory,'ffmpeg.log'),encoded.stderr);
 return frames.map((frame,index)=>({frame,path:path.join(directory,`caption-${String(index).padStart(3,'0')}.png`),width:canvas.width,height:canvas.height}));
}
