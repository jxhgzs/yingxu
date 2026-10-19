/**
 * Independent, versioned interpretation of documented adjustment equations.
 * The version identifies our mathematical contract, not a native draft version.
 * Inputs are normalized RGB; colour space and active Jianying resource generation
 * remain unverified. This module does not assert native pixel equivalence.
 */
import {applyContrastChannel,contrastParameters} from './color-contrast.ts';
import type {ContrastParameters} from './color-contrast.ts';
import {temperatureTintMatrix} from './color-temperature.ts';
import type {TemperatureMatrix} from './color-temperature.ts';
export type ColorAdjustments={
  version:'combine-adjust-v2';brightness?:number;contrast?:number;saturation?:number;highlight?:number;shadow?:number;temperature?:number;tint?:number;
};
export type RGB=readonly [number,number,number];
export type ColorAdjustmentStage=
  | {kind:'brightness';exponent:number;inputOffset:number}
  | {kind:'contrast';intensity:number;parameters:ContrastParameters}
  | {kind:'saturation';factor:number}
  | {kind:'highlight'|'shadow';exponent:number}
  | {kind:'temperatureTint';matrix:TemperatureMatrix};
export const COLOR_EFFECT_EPSILON=1e-5;
export const COLOR_LUMINANCE=[.208540,.702086,.089374] as const;
const fields=['brightness','contrast','saturation','highlight','shadow','temperature','tint'] as const;
const clamp=(v:number)=>Math.min(1,Math.max(0,v));

export function validateColorAdjustments(value:unknown):asserts value is ColorAdjustments{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_COLOR_ADJUSTMENTS');
  const v=value as Record<string,unknown>;
  if(v.version!=='combine-adjust-v2'||Object.keys(v).some(k=>k!=='version'&&!fields.includes(k as typeof fields[number])))throw Error('INVALID_COLOR_ADJUSTMENTS: version or field');
  for(const field of fields)if(v[field]!==undefined&&(typeof v[field]!=='number'||!Number.isFinite(v[field])||Math.abs(v[field])>1))throw Error(`INVALID_COLOR_ADJUSTMENTS: ${field}`);
}
export function normalizeColorAdjustments(value?:ColorAdjustments):Required<ColorAdjustments>{
  if(value!==undefined)validateColorAdjustments(value);
  return {version:'combine-adjust-v2',brightness:value?.brightness??0,contrast:value?.contrast??0,saturation:value?.saturation??0,highlight:value?.highlight??0,shadow:value?.shadow??0,temperature:value?.temperature??0,tint:value?.tint??0};
}
/** Computes each intensity mapping once for CPU, geq and shader consumers. */
export function colorAdjustmentStages(value?:ColorAdjustments):ColorAdjustmentStage[]{
  const v=normalizeColorAdjustments(value),stages:ColorAdjustmentStage[]=[];
  if(Math.abs(v.brightness)>COLOR_EFFECT_EPSILON){
    const i=v.brightness,b=i<=0?i:i<=.7?.3*i:.6333*i-.2333;
    stages.push({kind:'brightness',exponent:b>0?1+5*b:1/(1-2.5*b),inputOffset:b<0?.01*b:0});
  }
  if(Math.abs(v.contrast)>COLOR_EFFECT_EPSILON)stages.push({kind:'contrast',intensity:v.contrast,parameters:contrastParameters(v.contrast)});
  if(Math.abs(v.saturation)>COLOR_EFFECT_EPSILON)stages.push({kind:'saturation',factor:1+v.saturation});
  for(const kind of ['highlight','shadow'] as const){
    const i=v[kind];
    if(Math.abs(i)>COLOR_EFFECT_EPSILON){
      const sign=kind==='highlight'?1:-1;
      stages.push({kind,exponent:1+sign*.503*i+.183*i*i+sign*.147*i*i*i+.067*i*i*i*i});
    }
  }
  if(Math.abs(v.temperature)>COLOR_EFFECT_EPSILON||Math.abs(v.tint)>COLOR_EFFECT_EPSILON)stages.push({kind:'temperatureTint',matrix:temperatureTintMatrix(v.temperature,v.tint)});
  return stages;
}
export function hasColorAdjustments(value?:ColorAdjustments):boolean{return colorAdjustmentStages(value).length>0;}

/** Normalized RGB only; every active stage clamps before the next stage. */
export function applyColorAdjustments(rgb:RGB,value?:ColorAdjustments):[number,number,number]{
  if(!Array.isArray(rgb)||rgb.length!==3||!rgb.every(c=>typeof c==='number'&&Number.isFinite(c)&&c>=0&&c<=1))throw Error('INVALID_COLOR_RGB');
  let result:[number,number,number]=[rgb[0],rgb[1],rgb[2]];
  for(const stage of colorAdjustmentStages(value)){
    if(stage.kind==='saturation'){
      const grey=result.reduce((sum,c,i)=>sum+c*COLOR_LUMINANCE[i],0);
      result=result.map(c=>clamp(c*stage.factor+grey*(1-stage.factor))) as [number,number,number];
    }else if(stage.kind==='temperatureTint'){
      const input=result;
      result=stage.matrix.map(row=>clamp(row[0]*input[0]+row[1]*input[1]+row[2]*input[2])) as [number,number,number];
    }else if(stage.kind==='contrast'){
      result=result.map(c=>applyContrastChannel(c,stage.intensity)) as [number,number,number];
    }else{
      result=result.map(c=>{
        if(stage.kind==='brightness')return clamp(1-Math.pow(1-c-stage.inputOffset,stage.exponent));
        const x=stage.kind==='highlight'?1-c:c;
        const shaped=Math.pow(x,stage.exponent)+(stage.exponent-1)*(x*x-x*x*x);
        return clamp(stage.kind==='highlight'?1-shaped:shaped);
      }) as [number,number,number];
    }
  }
  return result;
}
