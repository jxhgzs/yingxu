import {COLOR_LUMINANCE,colorAdjustmentStages} from '../../../../packages/core/src/color-effects.ts';
import type {ColorAdjustments} from '../../../../packages/core/src/color-effects.ts';

/** Stage parameters are shared with the core/FFmpeg contracts; no slider mapping lives here. */
export function colorUniforms(value?:ColorAdjustments){
 const mask=new Int32Array(4),parameters=new Float32Array([1,1,1,1]);let brightnessOffset=0;
 for(const stage of colorAdjustmentStages(value)){
  const index=stage.kind==='brightness'?0:stage.kind==='saturation'?1:stage.kind==='highlight'?2:3;mask[index]=1;
  if(stage.kind==='saturation')parameters[index]=stage.factor;else parameters[index]=stage.exponent;
  if(stage.kind==='brightness')brightnessOffset=stage.inputOffset;
 }
 return {mask,parameters,brightnessOffset};
}
/** RGB math precedes premultiplication. Neutral channels bypass pow/clamp entirely. */
export const colorShader=`
uniform bvec4 u_fxEnabled;uniform vec4 u_fxParameters;uniform float u_fxBrightnessOffset;
vec3 previewColorAdjustments(vec3 adjusted){
 if(u_fxEnabled.x)adjusted=clamp(vec3(1.0)-pow(vec3(1.0)-adjusted-vec3(u_fxBrightnessOffset),vec3(u_fxParameters.x)),vec3(0.0),vec3(1.0));
 if(u_fxEnabled.y){float grey=dot(adjusted,vec3(${COLOR_LUMINANCE.join(',')}));adjusted=clamp(adjusted*u_fxParameters.y+vec3(grey*(1.0-u_fxParameters.y)),vec3(0.0),vec3(1.0));}
 if(u_fxEnabled.z){vec3 x=vec3(1.0)-adjusted;adjusted=clamp(vec3(1.0)-(pow(x,vec3(u_fxParameters.z))+(u_fxParameters.z-1.0)*(x*x-x*x*x)),vec3(0.0),vec3(1.0));}
 if(u_fxEnabled.w){vec3 x=adjusted;adjusted=clamp(pow(x,vec3(u_fxParameters.w))+(u_fxParameters.w-1.0)*(x*x-x*x*x),vec3(0.0),vec3(1.0));}
 return adjusted;
}`;

export type ColorGL=WebGL2RenderingContext&{unpackColorSpace?:string;drawingBufferColorSpace?:string};
export type PreviewColorState={contract:'browser-srgb-v1';drawingBufferColorSpace:string;unpackColorSpace:string;unpackConversion:'browser-default'|'none'|'unknown';unpackConversionEnum:number;framebufferFormat:'rgba8';mixDomain:'encoded-component-values';premultipliedAlpha:false};
export function previewColorState(gl:ColorGL):PreviewColorState{
 const conversion=gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) as number;
 return {contract:'browser-srgb-v1',drawingBufferColorSpace:gl.drawingBufferColorSpace??'legacy-default-srgb',unpackColorSpace:gl.unpackColorSpace??'legacy-browser-default',unpackConversion:conversion===gl.NONE?'none':conversion===gl.BROWSER_DEFAULT_WEBGL?'browser-default':'unknown',unpackConversionEnum:conversion,framebufferFormat:'rgba8',mixDomain:'encoded-component-values',premultipliedAlpha:false};
}
export type PixelPoint={x:number;y:number};
export type PixelRead=PixelPoint&{rgba:[number,number,number,number]};
export type ColorReadback={mode:'browser-default'|'none';state:PreviewColorState;width:number;height:number;final:PixelRead[];transitions:{id:string;progress:number;outgoing:PixelRead[];incoming:PixelRead[]}[]};
export function validatePixelPoints(points:PixelPoint[],width:number,height:number){
 if(!Array.isArray(points)||points.length<1||points.length>16||points.some(p=>!p||!Number.isInteger(p.x)||!Number.isInteger(p.y)||p.x<0||p.y<0||p.x>=width||p.y>=height))throw Error('GPU_DIAGNOSTIC_POINTS_INVALID');
}
