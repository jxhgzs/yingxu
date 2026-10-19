import type {RGB} from './color-effects.ts';

export type Vignette={version:'v1';intensity:number};
export type VignetteParameters={mode:'darken'|'lighten';amount:number;inner:number;outer:number};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));
const cubic=(t:number,a:number,b:number)=>3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;
export function validateVignette(value:unknown):asserts value is Vignette{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_VIGNETTE');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>k!=='version'&&k!=='intensity')||v.version!=='v1'||typeof v.intensity!=='number'||!Number.isFinite(v.intensity)||Math.abs(v.intensity)>1)throw Error('INVALID_VIGNETTE');
}
/** Independent curve reconstruction for the observed vignetting_v1 resource. */
export function vignetteParameters(intensity:number):VignetteParameters{
 validateVignette({version:'v1',intensity});
 const [x1,y1,x2,y2]=intensity>0?[.2,.45,.63,.81]:[.65,.2,.81,.63];
 const x=(intensity+1)/2;let lo=0,hi=1;
 while(hi-lo>=.0001){const mid=(lo+hi)/2;if(cubic(mid,x1,x2)<x)lo=mid;else hi=mid;}
 const p=2*cubic((lo+hi)/2,y1,y2)-1,s=1.415;
 return intensity>=.0001?{mode:'darken',amount:p,inner:(1-.9*Math.abs(p))*s,outer:(1.4-.55*Math.abs(p))*s}:{mode:'lighten',amount:1,inner:(1-.8*Math.abs(intensity))*s,outer:(1.5-.6*Math.abs(p))*s};
}
/** UV belongs to the source image, before clip geometry; no aspect correction. */
export function vignetteMix(u:number,v:number,parameters:VignetteParameters):number{
 if(![u,v].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('INVALID_VIGNETTE_UV');
 const distance=Math.hypot(2*u-1,2*v-1),q=clamp((distance-parameters.inner)/(parameters.outer-parameters.inner));return q*q*(3-2*q);
}
export function applyVignette(rgb:RGB,u:number,v:number,value?:Vignette):[number,number,number]{
 if(rgb.length!==3||!rgb.every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('INVALID_COLOR_RGB');
 if(!value)return [...rgb];validateVignette(value);
 if(value.intensity===0)return [...rgb];
 const p=vignetteParameters(value.intensity),mix=vignetteMix(u,v,p);
 return rgb.map(c=>clamp(p.mode==='darken'?c*(1-mix*p.amount):c*(1-mix)+mix)) as [number,number,number];
}
