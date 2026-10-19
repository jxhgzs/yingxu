import {rational,sub,compare,ZERO} from './time.ts';
import type {Rational} from './time.ts';

export type SubtitleFormat='srt'|'vtt';
export type SubtitleDiagnostic={code:string;severity:'info'|'warning';message:string;line?:number;cueIndex?:number};
export type SubtitleCue={index:number;id?:string;start:Rational;duration:Rational;text:string};
export type ParsedSubtitles={format:SubtitleFormat;sourceText:string;cues:SubtitleCue[];diagnostics:SubtitleDiagnostic[]};
export const SUBTITLE_LIMITS={bytes:4*1024*1024,cues:5000,text:2000} as const;
export class SubtitleParseError extends Error {
  code:string;line?:number;cueIndex?:number;
  constructor(code:string,line?:number,cueIndex?:number){super(`${code}${line===undefined?'':`: line ${line}`}`);this.name='SubtitleParseError';this.code=code;this.line=line;this.cueIndex=cueIndex;}
}
function fail(code:string,line?:number,cueIndex?:number):never{throw new SubtitleParseError(code,line,cueIndex);}
function timestamp(value:string,format:SubtitleFormat,line:number,index:number):Rational{
  const match=(format==='srt'?/^(\d{2,20}):([0-5]\d):([0-5]\d),(\d{3})$/:/^(?:(\d{2,20}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/).exec(value);
  if(!match)fail('SUBTITLE_INVALID_TIMESTAMP',line,index);
  return rational(((BigInt(match[1]||0)*60n+BigInt(match[2]))*60n+BigInt(match[3]))*1000n+BigInt(match[4]),1000n);
}
function visibleText(raw:string,format:SubtitleFormat,line:number,index:number,diagnostics:SubtitleDiagnostic[]):string{
  let removed=false;
  // 5.9.0 imports SRT tags and entities as literal visible characters.
  const text=format==='srt'?raw:raw.replace(/<[^<>\n]*>/g,tag=>{
    // Never construct DOM, evaluate HTML, or interpret CSS. Unsupported timed/layout markup is rejected.
    const body=tag.slice(1,-1);
    const allowed=/^(?:\/?[biu]|\/?c(?:\.[\w-]+)*|\/?v(?:[ \t]+[^<>]+)?|\/?lang(?:[ \t]+[^<>]+)?)$/.test(body);
    if(!allowed)fail('SUBTITLE_UNSUPPORTED_MARKUP',line,index);
    removed=true;return '';
  });
  if(format==='vtt'&&/<[\w/!]/.test(text))fail('SUBTITLE_UNSUPPORTED_MARKUP',line,index);
  if(removed)diagnostics.push({code:'SUBTITLE_FORMATTING_REMOVED',severity:'warning',message:'格式、颜色、类别或说话者标记将转换为普通文字，原始字幕保留。',line,cueIndex:index});
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',nbsp:'\u00a0',lrm:'\u200e',rlm:'\u200f',quot:'"',apos:"'"};
  const decoded=(format==='srt'?text:text.replace(/&(#x[\da-fA-F]+|#\d+|[A-Za-z][\w]*);/g,(_whole,key:string)=>{
    if(Object.hasOwn(entities,key)&&!['quot','apos'].includes(key))return entities[key];
    fail('SUBTITLE_UNSUPPORTED_ENTITY',line,index);
  })).replace(/\r\n?/g,'\n');
  if(/\{\\[^}]*\}/.test(decoded))diagnostics.push({code:'SUBTITLE_ASS_MARKUP_LITERAL',severity:'warning',message:'ASS覆盖标记仅作为普通可见文字导入，不执行其样式或位置命令。',line,cueIndex:index});
  if(!decoded.trim())fail('SUBTITLE_EMPTY_TEXT',line,index);
  if(decoded.length>SUBTITLE_LIMITS.text)fail('SUBTITLE_TEXT_LIMIT',line,index);
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(decoded))fail('SUBTITLE_INVALID_TEXT',line,index);
  for(const char of decoded){const point=char.codePointAt(0)!;if(point>=0xd800&&point<=0xdfff)fail('SUBTITLE_INVALID_TEXT',line,index);}
  return decoded;
}

/** A strict supported subset: a rejected cue rejects the whole file; no partial import. */
export function parseSubtitles(input:string,format:SubtitleFormat):ParsedSubtitles{
  if(typeof input!=='string'||input.length>SUBTITLE_LIMITS.bytes||new TextEncoder().encode(input).length>SUBTITLE_LIMITS.bytes)fail('SUBTITLE_FILE_LIMIT');
  if(format!=='srt'&&format!=='vtt')fail('SUBTITLE_UNSUPPORTED_FORMAT');
  const lines=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n'),diagnostics:SubtitleDiagnostic[]=[],cues:SubtitleCue[]=[];
  let cursor=0,blocks=0;
  if(format==='vtt'){
    if(!/^WEBVTT(?:[ \t].*)?$/.test(lines[0])||lines[0].includes('-->'))fail('SUBTITLE_INVALID_HEADER',1);
    if(lines[0].slice(6).trim())diagnostics.push({code:'SUBTITLE_HEADER_IGNORED',severity:'info',message:'WebVTT文件说明不作为画面文字导入。',line:1});
    cursor=1;
    if(cursor<lines.length&&lines[cursor].trim())fail('SUBTITLE_UNSUPPORTED_HEADER',cursor+1);
  }
  while(cursor<lines.length){
    if(!lines[cursor].trim()){cursor++;continue;}
    if(++blocks>10000)fail('SUBTITLE_BLOCK_LIMIT',cursor+1);
    const line=cursor+1,block:string[]=[];
    while(cursor<lines.length&&lines[cursor].trim())block.push(lines[cursor++]);
    if(format==='vtt'&&/^NOTE(?:[ \t]|$)/.test(block[0])){diagnostics.push({code:'SUBTITLE_NOTE_IGNORED',severity:'info',message:'WebVTT注释不作为画面文字导入。',line});continue;}
    if(format==='vtt'&&/^(?:STYLE|REGION)(?:[ \t]|$)/.test(block[0]))fail('SUBTITLE_UNSUPPORTED_LAYOUT',line);
    if(cues.length>=SUBTITLE_LIMITS.cues)fail('SUBTITLE_CUE_LIMIT',line);
    const index=cues.length+1;let id:string|undefined,timing=0;
    if(!block[0].includes('-->')){
      if(format==='srt'&&!/^\d+$/.test(block[0].trim()))fail('SUBTITLE_INVALID_CUE',line,index);
      id=block[0];timing=1;if(id.length>1000)fail('SUBTITLE_INVALID_CUE',line,index);
    }
    const timingLine=block[timing],match=timingLine&&/^[ \t]*(\S+)[ \t]+-->[ \t]+(\S+)(.*)$/.exec(timingLine);
    if(!match)fail('SUBTITLE_INVALID_TIMING',line+timing,index);
    if(match[3].trim())fail('SUBTITLE_UNSUPPORTED_CUE_SETTINGS',line+timing,index);
    const start=timestamp(match[1],format,line+timing,index),end=timestamp(match[2],format,line+timing,index);
    if(compare(start,ZERO)<0||compare(end,start)<=0)fail('SUBTITLE_INVALID_DURATION',line+timing,index);
    const rawText=block.slice(timing+1).join('\n');
    const nestedTiming=/(?:^|\n)[ \t]*\d{2,20}:\d{2}:\d{2},\d{3}[ \t]+-->[ \t]+\S/.test(rawText);
    if(format==='vtt'?rawText.includes('-->'):nestedTiming)fail('SUBTITLE_MISSING_SEPARATOR',line+timing+1,index);
    const text=visibleText(rawText,format,line+timing+1,index,diagnostics);
    cues.push({index,...(id===undefined?{}:{id}),start,duration:sub(end,start),text});
  }
  if(!cues.length)fail('SUBTITLE_EMPTY_FILE');
  return {format,sourceText:input,cues,diagnostics};
}
