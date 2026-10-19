import {check,duration,validRational,validateDocument} from './document.ts';
import type {Document,Range} from './document.ts';
import {add,compare,div,mul,rational,toNumber,ZERO} from './time.ts';
import type {Rational} from './time.ts';
export type ExportFormat='mp4'|'mov'|'gif'|'mp3'|'wav'|'m4a';
export type ExportSettings={format?:ExportFormat;size?:{width:number;height:number};fps?:Rational;videoCodec?:'h264'|'hevc';videoBitrateKbps?:number;
  audioSampleRate?:44100|48000;audioBitrateKbps?:number;range?:Range};
export type ResolvedExport={version:1;format:ExportFormat;extension:string;mime:string;audioOnly:boolean;hasAudio:boolean;
  width:number;height:number;fps:Rational;videoCodec:'h264'|'hevc';videoBitrateKbps?:number;audioSampleRate:44100|48000;audioBitrateKbps:number;
  startFrame:number;endFrame:number;frameCount:number;actualStart:Rational;duration:number};
const even=(v:number)=>Math.max(2,Math.round(v/2)*2);
const formats:Record<ExportFormat,{mime:string;audioOnly:boolean;hasAudio:boolean}>={mp4:{mime:'video/mp4',audioOnly:false,hasAudio:true},mov:{mime:'video/quicktime',audioOnly:false,hasAudio:true},
  gif:{mime:'image/gif',audioOnly:false,hasAudio:false},mp3:{mime:'audio/mpeg',audioOnly:true,hasAudio:true},wav:{mime:'audio/wav',audioOnly:true,hasAudio:true},m4a:{mime:'audio/mp4',audioOnly:true,hasAudio:true}};
const ceilFrame=(time:Rational,fps:Rational)=>{const f=mul(time,fps),n=BigInt(f.numerator),d=BigInt(f.denominator);const result=Number((n+d-1n)/d);check(Number.isSafeInteger(result),'EXPORT_FRAME_LIMIT');return result;};
export function resolveExportSettings(doc:Document,input:ExportSettings={}):ResolvedExport{
  validateDocument(doc);check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_EXPORT_SETTINGS');
  check(Object.keys(input).every(k=>['format','size','fps','videoCodec','videoBitrateKbps','audioSampleRate','audioBitrateKbps','range'].includes(k)),'INVALID_EXPORT_SETTINGS');
  const format=input.format??'mp4';check(Object.hasOwn(formats,format),'INVALID_EXPORT_FORMAT');const profile=formats[format];
  const fps=structuredClone(input.fps??(format==='gif'?rational(10):doc.fps));validRational(fps);
  check(compare(fps,ZERO)>0&&compare(fps,rational(120))<=0,'INVALID_EXPORT_FPS');
  if(format==='gif')check(fps.denominator==='1'&&[5,10,20,25,50].includes(Number(fps.numerator)),'GIF_FPS_UNREPRESENTABLE');
  if(input.size!==undefined)check(input.size&&typeof input.size==='object'&&!Array.isArray(input.size),'INVALID_EXPORT_SIZE');
  const width=input.size?.width??even(doc.canvas.width*(format==='gif'?240/doc.canvas.height:1)),height=input.size?.height??(format==='gif'?240:even(doc.canvas.height));
  check([width,height].every(n=>Number.isSafeInteger(n)&&n>=2&&n<=16384&&n%2===0),'INVALID_EXPORT_SIZE');
  check(Math.abs(width*doc.canvas.height-height*doc.canvas.width)<=Math.max(doc.canvas.width,doc.canvas.height)*1.1,'EXPORT_ASPECT_MISMATCH');
  const videoCodec=input.videoCodec??'h264';check(['h264','hevc'].includes(videoCodec),'INVALID_EXPORT_CODEC');
  const videoBitrateKbps=input.videoBitrateKbps;check(videoBitrateKbps===undefined||Number.isInteger(videoBitrateKbps)&&videoBitrateKbps>=100&&videoBitrateKbps<=200000,'INVALID_EXPORT_BITRATE');
  const audioSampleRate=input.audioSampleRate??44100;check([44100,48000].includes(audioSampleRate),'INVALID_EXPORT_SAMPLE_RATE');
  const audioBitrateKbps=input.audioBitrateKbps??(format==='mp3'?128:192);
  check(Number.isInteger(audioBitrateKbps)&&audioBitrateKbps>=32&&audioBitrateKbps<=512,'INVALID_EXPORT_BITRATE');
  if(format==='mp3')check([32,40,48,56,64,80,96,112,128,160,192,224,256,320].includes(audioBitrateKbps),'INVALID_EXPORT_BITRATE');
  const end=duration(doc);check(compare(end,ZERO)>0,'EMPTY_TIMELINE');
  const range=input.range??{start:ZERO,duration:end};check(range&&typeof range==='object','INVALID_EXPORT_RANGE');validRational(range.start);validRational(range.duration);
  check(compare(range.start,ZERO)>=0&&compare(range.duration,ZERO)>0&&compare(add(range.start,range.duration),end)<=0,'INVALID_EXPORT_RANGE');
  const startFrame=ceilFrame(range.start,fps),endFrame=ceilFrame(add(range.start,range.duration),fps),frameCount=endFrame-startFrame;
  check(frameCount>0&&frameCount<=10000000,'EXPORT_FRAME_LIMIT');
  return {version:1,format,extension:format,...profile,width,height,fps,videoCodec,videoBitrateKbps,audioSampleRate,audioBitrateKbps,
    startFrame,endFrame,frameCount,actualStart:div(rational(startFrame),fps),duration:frameCount/toNumber(fps)};
}
