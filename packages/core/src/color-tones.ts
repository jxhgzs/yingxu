/**
 * Independent mathematical candidates from fixed Jianying 5.9 resource data.
 * Active native path/version and encoded output must be checked before the
 * product stack or controls expose them. No private shader or texture is used.
 */
export type BlackWhiteParameters={slope:number;offset:number};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function intensity(value:number,min=-1):void{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>1)throw Error('INVALID_COLOR_TONE_INTENSITY');}
function channel(value:number):void{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw Error('INVALID_COLOR_TONE_CHANNEL');}
export function blackWhiteParameters(black:number,white:number):BlackWhiteParameters{
 intensity(black);intensity(white);
 const xw=Math.max(white>=0?1-.5*white:1,.005),yw=Math.max(white>=0?1:1+.5*white,.005);
 const xb=Math.min(black>=0?0:-.5*black,xw-.005),yb=Math.min(black>=0?.5*black:0,yw-.005);
 const slope=(yw-yb)/(xw-xb);return {slope,offset:yb-slope*xb};
}
export function applyBlackWhiteChannel(value:number,black:number,white:number):number{
 channel(value);const p=blackWhiteParameters(black,white);return clamp(value*p.slope+p.offset);
}
/** Seventeen observed scalar nodes; the full 17^3 table was separable. */
export const FADE_NODES=Object.freeze([69,72,75,80,86,94,104,115,128,141,156,170,182,193,203,211,218]);
export function fadeCurve(value:number):number{
 channel(value);const position=value*16,index=Math.min(15,Math.floor(position)),mix=position-index;
 return (FADE_NODES[index]*(1-mix)+FADE_NODES[index+1]*mix)/255;
}
export function applyFadeChannel(value:number,amount:number):number{
 channel(value);intensity(amount,0);return clamp(value*(1-amount)+fadeCurve(value)*amount);
}
