import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {applyColorAdjustments,colorAdjustmentStages,normalizeColorAdjustments,COLOR_LUMINANCE} from '../../core/src/color-effects.ts';
import type {ColorAdjustments} from '../../core/src/color-effects.ts';

// FFmpeg lut1d supports float planar RGB and clips LUT input coordinates. Its
// float colorchannelmixer does not clamp. Always put a post LUT after a matrix.
// https://www.ffmpeg.org/ffmpeg-filters.html#lut1d
// https://www.ffmpeg.org/ffmpeg-filters.html#colorchannelmixer
const COMPILER='color-lut1d-v1';
export const COLOR_LUT_SAMPLES=65536;
export const COLOR_LUT_MAX_FILE_BYTES=6*1024*1024;
export const COLOR_LUT_MAX_FILES=64;
const MAX_MEMORY_BYTES=12*1024*1024;
const filenamePattern=/^color-fx-v1-[a-f0-9]{64}\.cube$/;
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
type LutPayload={name:string;bytes:Buffer;sha256:string;samples:number};
type LutRecord={name:string;bytes:number;sha256:string;samples:number;cacheHit:boolean};
export type PreparedColorEffects={filter:string;files:string[];metadata:{
  compiler:typeof COMPILER;key:string;pixelFormat:'gbrapf32le';neutral:boolean;
  interpolation:'linear';luts:LutRecord[];matrix?:number[];temperatureMatrix?:number[];
  limits:{maxFiles:number;maxFileBytes:number};
}};
const memoryCache=new Map<string,LutPayload>();
const directoryQueues=new Map<string,Promise<unknown>>();

function payload(value:ColorAdjustments,samples:number):LutPayload{
  const stages=colorAdjustmentStages(value),key=digest(JSON.stringify({compiler:COMPILER,stages,samples}));
  const cached=memoryCache.get(key);
  if(cached){memoryCache.delete(key);memoryCache.set(key,cached);return cached;}
  const lines=[`TITLE "${COMPILER}"`,`LUT_1D_SIZE ${samples}`,'DOMAIN_MIN 0 0 0','DOMAIN_MAX 1 1 1'];
  for(let i=0;i<samples;i++){
    const input=i/(samples-1),output=applyColorAdjustments([input,input,input],value)[0].toPrecision(17);
    lines.push(`${output} ${output} ${output}`);
  }
  const bytes=Buffer.from(lines.join('\n')+'\n');
  if(bytes.length>COLOR_LUT_MAX_FILE_BYTES)throw Error('COLOR_EFFECT_LUT_SIZE_LIMIT');
  const result={name:`color-fx-v1-${key}.cube`,bytes,sha256:digest(bytes),samples};
  let retained=[...memoryCache.values()].reduce((sum,v)=>sum+v.bytes.length,0);
  while(retained+bytes.length>MAX_MEMORY_BYTES&&memoryCache.size){
    const first=memoryCache.keys().next().value!;retained-=memoryCache.get(first)!.bytes.length;memoryCache.delete(first);
  }
  memoryCache.set(key,result);return result;
}
async function verifiedExisting(file:string,expected:LutPayload):Promise<boolean>{
  let handle;
  try{
    handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    const stat=await handle.stat();
    if(!stat.isFile())throw Error('COLOR_EFFECT_LUT_UNSAFE_FILE');
    if(stat.size!==expected.bytes.length||stat.size>COLOR_LUT_MAX_FILE_BYTES)throw Error('COLOR_EFFECT_LUT_CORRUPT');
    const bytes=Buffer.allocUnsafe(expected.bytes.length);let offset=0;
    while(offset<bytes.length){const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}
    const extra=Buffer.allocUnsafe(1);
    if(offset!==bytes.length||(await handle.read(extra,0,1,bytes.length)).bytesRead||digest(bytes)!==expected.sha256)throw Error('COLOR_EFFECT_LUT_CORRUPT');
    return true;
  }catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(code==='ENOENT')return false;
    if(code==='ELOOP')throw Error('COLOR_EFFECT_LUT_UNSAFE_FILE');
    throw error;
  }finally{await handle?.close();}
}
async function writeLut(directory:string,value:LutPayload):Promise<LutRecord>{
  const file=path.join(directory,value.name);
  let hit=await verifiedExisting(file,value);
  if(!hit){
    const entries=await fs.readdir(directory);
    if(entries.filter(name=>filenamePattern.test(name)).length>=COLOR_LUT_MAX_FILES)throw Error('COLOR_EFFECT_LUT_CACHE_LIMIT');
    const temporary=path.join(directory,`.color-fx-${randomUUID()}.tmp`);
    let handle;
    try{
      handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(value.bytes);await handle.sync();await handle.close();handle=undefined;
      // An atomic create avoids overwriting another writer or a symlink.
      try{await fs.link(temporary,file);}catch(error){
        if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
        hit=await verifiedExisting(file,value);if(!hit)throw Error('COLOR_EFFECT_LUT_CACHE_CHANGED');
      }
    }finally{await handle?.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  return {name:value.name,bytes:value.bytes.length,sha256:value.sha256,samples:value.samples,cacheHit:hit};
}

/**
 * Builds bounded, independently generated 1D tables, never packaged assets.
 * All arithmetic stages use float GBRAP; LUT interpolation is an approximation
 * to the CPU equations and must retain the pixel-error checks in the test suite.
 * Run FFmpeg with directory as cwd. Filter file names are safe relative basenames.
 * The directory quota is serialized within this process; jobs own their directory.
 */
export async function prepareColorEffects(value:ColorAdjustments|undefined,directory:string):Promise<PreparedColorEffects>{
  const normalized=normalizeColorAdjustments(value),stages=colorAdjustmentStages(normalized),key=digest(JSON.stringify({compiler:COMPILER,stages}));
  if(typeof directory!=='string'||directory.length===0||directory.includes('\0'))throw Error('INVALID_COLOR_EFFECT_DIRECTORY');
  const metadata:PreparedColorEffects['metadata']={compiler:COMPILER,key,pixelFormat:'gbrapf32le',neutral:!stages.length,interpolation:'linear',luts:[],limits:{maxFiles:COLOR_LUT_MAX_FILES,maxFileBytes:COLOR_LUT_MAX_FILE_BYTES}};
  if(!stages.length)return {filter:'',files:[],metadata};
  const target=path.resolve(directory);
  const previous=directoryQueues.get(target)??Promise.resolve();
  const operation=previous.catch(()=>{}).then(async()=>{
    await fs.mkdir(target,{recursive:true});
    const filters=['format=gbrapf32le'];
    const hasPre=stages.some(stage=>stage.kind==='brightness'||stage.kind==='contrast');
    if(hasPre){
      const lut=await writeLut(target,payload({version:'combine-adjust-v2',brightness:normalized.brightness,contrast:normalized.contrast},COLOR_LUT_SAMPLES));
      metadata.luts.push(lut);filters.push(`lut1d=file=${lut.name}:interp=linear`);
    }
    const saturation=stages.find(stage=>stage.kind==='saturation');
    if(saturation){
      const factor=saturation.factor;
      const matrix=Array.from({length:9},(_,i)=>COLOR_LUMINANCE[i%3]*(1-factor)+(Math.floor(i/3)===i%3?factor:0));
      metadata.matrix=matrix;
      const fields=['rr','rg','rb','gr','gg','gb','br','bg','bb'];
      filters.push(`colorchannelmixer=${matrix.map((coefficient,i)=>`${fields[i]}=${coefficient}`).join(':')}:pc=none:pa=0`);
    }
    const hasPost=stages.some(stage=>stage.kind==='highlight'||stage.kind==='shadow');
    if(hasPost||saturation){
      const lut=await writeLut(target,payload({version:'combine-adjust-v2',highlight:normalized.highlight,shadow:normalized.shadow},hasPost?COLOR_LUT_SAMPLES:2));
      metadata.luts.push(lut);filters.push(`lut1d=file=${lut.name}:interp=linear`);
    }
    const temperature=stages.find(stage=>stage.kind==='temperatureTint');
    if(temperature){
      const matrix=temperature.matrix.flat();metadata.temperatureMatrix=matrix;
      const fields=['rr','rg','rb','gr','gg','gb','br','bg','bb'];
      filters.push(`colorchannelmixer=${matrix.map((coefficient,i)=>`${fields[i]}=${coefficient}`).join(':')}:pc=none:pa=0`);
      // Float colorchannelmixer leaves out-of-gamut values. Clamp here before
      // another effect/format conversion, rather than at the end of the graph.
      const lut=await writeLut(target,payload({version:'combine-adjust-v2'},2));
      metadata.luts.push(lut);filters.push(`lut1d=file=${lut.name}:interp=linear`);
    }
    filters.push('format=gbrapf32le');
    return {filter:filters.join(','),files:metadata.luts.map(lut=>lut.name),metadata};
  });
  directoryQueues.set(target,operation);
  try{return await operation;}finally{if(directoryQueues.get(target)===operation)directoryQueues.delete(target);}
}
