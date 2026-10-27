/**
 * Target-clock interpretation of the individually verified Jianying 5.9 text
 * presets: 1644304 (appear), 1644600 (disappear), 1644275 (typewriter I),
 * 1644514 (loop flash), 1644264 (enlarge entrance), 1644520 (glyph sway),
 * 1644276 (quartic per-letter entrance), 1644602 (shrink exit),
 * 1644525 (whole-text step bounce).
 * Resource source stays outside the product. Evidence and remaining glyph and
 * encoded-pixel differences: docs/qa/2026-10-19-rea-text-animation.md.
 */
import {add,compare,div,mul,rational,sub,toNumber,ZERO} from './time.ts';
import type {Rational} from './time.ts';

export type TextAnimation={phase:'in'|'out'|'loop';kind:'fade'|'typewriter'|'typewriter-soft'|'flash'|'zoom-in'|'zoom-out'|'sway'|'bounce'|'alternate-scale';duration:Rational};

function time(value:unknown):asserts value is Rational{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_TEXT_ANIMATION_DURATION');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(key=>!['numerator','denominator'].includes(key))||typeof v.numerator!=='string'||typeof v.denominator!=='string')throw Error('INVALID_TEXT_ANIMATION_DURATION');
  let normalized:Rational;
  try{normalized=rational(v.numerator,v.denominator);}catch{throw Error('INVALID_TEXT_ANIMATION_DURATION');}
  if(normalized.numerator!==v.numerator||normalized.denominator!==v.denominator)throw Error('INVALID_TEXT_ANIMATION_DURATION');
}

/** Strict supported subset; this does not silently trim native animation time. */
export function validateTextAnimations(value:unknown,clipDuration:Rational):asserts value is TextAnimation[]{
  time(clipDuration);
  if(compare(clipDuration,ZERO)<=0)throw Error('INVALID_TEXT_ANIMATION_CLIP_DURATION');
  if(!Array.isArray(value)||value.length>3)throw Error('INVALID_TEXT_ANIMATIONS');
  const phases=new Set<string>();let total=ZERO;let loopDuration:Rational|undefined;
  for(const item of value){
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error('INVALID_TEXT_ANIMATION');
    const v=item as Record<string,unknown>;
    if(Object.keys(v).some(key=>!['phase','kind','duration'].includes(key)))throw Error('UNSUPPORTED_TEXT_ANIMATION_FIELD');
    if(v.phase!=='in'&&v.phase!=='out'&&v.phase!=='loop')throw Error('TEXT_ANIMATION_PHASE_UNVERIFIED');
    const kinds=v.phase==='loop'?['flash','sway','bounce','alternate-scale']:v.phase==='out'?['fade','zoom-out']:['fade','typewriter','typewriter-soft','zoom-in'];
    if(!kinds.includes(String(v.kind)))throw Error('TEXT_ANIMATION_KIND_UNVERIFIED');
    if(phases.has(v.phase))throw Error('DUPLICATE_TEXT_ANIMATION_PHASE');
    phases.add(v.phase);time(v.duration);
    if(compare(v.duration,ZERO)<=0||compare(v.duration,clipDuration)>0)throw Error('INVALID_TEXT_ANIMATION_DURATION');
    if(v.phase==='loop')loopDuration=v.duration;else total=add(total,v.duration);
  }
  if(compare(total,clipDuration)>0)throw Error('TEXT_ANIMATION_OVERLAP_UNVERIFIED');
  // Period is independent of the in/out windows. Unsupported overlap is rejected,
  // rather than applying the native repairer's unverified short-clip branches.
  if(loopDuration&&(compare(loopDuration,rational(1,10))<0||compare(loopDuration,sub(clipDuration,total))>0))throw Error('INVALID_TEXT_ANIMATION_DURATION');
}

const progress=(elapsed:Rational,duration:Rational):number=>
  compare(elapsed,ZERO)<=0?0:compare(elapsed,duration)>=0?1:toNumber(div(elapsed,duration));

/** Relative alpha. Caller retains the clip's own half-open active interval. */
export function textAnimationOpacity(animations:readonly TextAnimation[]|undefined,targetElapsed:Rational,targetDuration:Rational):number{
  const loop=animations?.find(animation=>animation.phase==='loop');
  if(loop){
    const entrance=animations?.find(animation=>animation.phase==='in');
    const exit=animations?.find(animation=>animation.phase==='out');
    // Actual native .3/.4/.5s probe: each stage replaces, rather than multiplies,
    // alpha. The exact entrance endpoint still belongs to the entrance stage.
    if(entrance&&compare(targetElapsed,entrance.duration)<=0){
      const p=progress(targetElapsed,entrance.duration);
      return entrance.kind==='fade'||entrance.kind==='zoom-in'?p*(2-p):1;
    }
    if(exit&&compare(targetElapsed,sub(targetDuration,exit.duration))>=0){
      const p=progress(sub(targetElapsed,sub(targetDuration,exit.duration)),exit.duration);
      return exit.kind==='zoom-out'?1-p*p:(1-p)*(1-p);
    }
    if(loop.kind==='sway'||loop.kind==='bounce'||loop.kind==='alternate-scale')return 1;
    const elapsed=sub(targetElapsed,entrance?.duration??ZERO);
    const cycles=div(elapsed,loop.duration);
    const denominator=BigInt(cycles.denominator);
    const remainder=((BigInt(cycles.numerator)%denominator)+denominator)%denominator;
    const r=toNumber(rational(remainder,denominator));
    return r<=.5?4*r*(1-r):1-(2*r-1)*(2*r-1);
  }
  let opacity=1;
  for(const animation of animations??[]){
    if(animation.kind!=='fade'&&animation.kind!=='zoom-in'&&animation.kind!=='zoom-out')continue;
    const elapsed=animation.phase==='in'?targetElapsed:sub(targetElapsed,sub(targetDuration,animation.duration));
    const p=progress(elapsed,animation.duration);
    opacity*=animation.phase==='in'?p*(2-p):animation.kind==='zoom-out'?1-p*p:(1-p)*(1-p);
  }
  return opacity;
}

/** Preset geometry and alpha share the target clock; source property curves stay separate. */
export function textAnimationState(animations:readonly TextAnimation[]|undefined,targetElapsed:Rational,targetDuration:Rational):{opacity:number;scale:number}{
  const entrance=animations?.find(animation=>animation.phase==='in'&&animation.kind==='zoom-in');
  const p=entrance?progress(targetElapsed,entrance.duration):1;
  const exit=animations?.find(animation=>animation.phase==='out'&&animation.kind==='zoom-out'),tail=exit?progress(sub(targetElapsed,sub(targetDuration,exit.duration)),exit.duration):0;
  return {opacity:textAnimationOpacity(animations,targetElapsed,targetDuration),scale:(entrance ? 0.5+0.5*p*(2-p) : 1)*(1-.5*tail*tail)};
}

/** Actual 1644520 rotates alternate character entries only during the loop stage. */
export function textAnimationGlyphState(animations:readonly TextAnimation[]|undefined,targetElapsed:Rational,targetDuration:Rational):{sway:boolean}{
 const loop=animations?.find(a=>a.phase==='loop'&&a.kind==='sway');if(!loop)return {sway:false};
 const entrance=animations?.find(a=>a.phase==='in'),exit=animations?.find(a=>a.phase==='out');
 if(entrance&&compare(targetElapsed,entrance.duration)<=0||exit&&compare(targetElapsed,sub(targetDuration,exit.duration))>=0)return {sway:false};
 const cycles=div(sub(targetElapsed,entrance?.duration??ZERO),loop.duration),d=BigInt(cycles.denominator),n=((BigInt(cycles.numerator)%d)+d)%d;
 // Native .3/.7, .3/1 and .5/1 combinations retain the preceding state
 // on exact half/full loop boundaries after the closed entrance endpoint.
 // Select the discrete left limit; do not perturb any animation/property clock.
 if(entrance){if(n===0n)return {sway:true};if(n*2n===d)return {sway:false};}
 return {sway:n*2n>=d};
}

/**
 * Conservative renderable-glyph policy, separate from structural validation.
 * ASCII spaces and LF line breaks count as entries, established by the native
 * mixed multiline probe. Combining and supplementary codepoints stay unknown.
 */
export function canRenderTextAnimationText(text:string):boolean{
  return typeof text==='string'&&text.length>0&&text.length<=2000&&/^[\n\u0020-\u007e\u4e00-\u9fff]+$/u.test(text);
}

/** 1644276: every original letter fades independently; space/LF remain clock entries. */
export function textAnimationLetterOpacities(animations:readonly TextAnimation[]|undefined,text:string,targetElapsed:Rational):number[]|undefined{
 const animation=animations?.find(a=>a.kind==='typewriter-soft');if(!animation)return;
 if(animation.phase!=='in')throw Error('TEXT_ANIMATION_KIND_UNVERIFIED');
 if(!canRenderTextAnimationText(text))throw Error('TEXT_ANIMATION_GLYPHS_UNVERIFIED');
 time(animation.duration);if(compare(animation.duration,ZERO)<=0)throw Error('INVALID_TEXT_ANIMATION_DURATION');
 return Array.from({length:text.length},(_,i)=>{const p=progress(targetElapsed,mul(animation.duration,rational(i+1,text.length+1)));return p*p*p*p;});
}

/**
 * Keep original shaping/layout and hide glyph suffixes; never re-centre a prefix.
 * Floor's 0.99999 threshold is compared as the exact rational 99999/100000.
 */
export function textAnimationVisibleCount(animation:TextAnimation,text:string,targetElapsed:Rational):number{
  if(animation.kind!=='typewriter')return Array.from(text).length;
  if(animation.phase!=='in')throw Error('TEXT_ANIMATION_KIND_UNVERIFIED');
  if(!canRenderTextAnimationText(text))throw Error('TEXT_ANIMATION_GLYPHS_UNVERIFIED');
  time(animation.duration);
  if(compare(animation.duration,ZERO)<=0)throw Error('INVALID_TEXT_ANIMATION_DURATION');
  if(compare(targetElapsed,ZERO)<=0)return 0;
  const count=text.length;
  const revealed=div(mul(targetElapsed,rational((count+1)*100000)),mul(animation.duration,rational(99999)));
  const exactCount=BigInt(revealed.numerator)/BigInt(revealed.denominator);
  return exactCount>=BigInt(count)?count:Number(exactCount);
}

/** 1644525 whole-text step motion, measured independently from glyph sway.
 * Returned downward displacement is a fraction of the canvas' longer side.
 * The native exit leaves the last loop output-frame position in place. Sample
 * that frame using the absolute output grid; never offset the property clock.
 */
export function textAnimationOffsetY(animations:readonly TextAnimation[]|undefined,targetElapsed:Rational,targetDuration:Rational,fps:Rational,targetStart:Rational=ZERO):number{
 const loop=animations?.find(a=>a.phase==='loop'&&a.kind==='bounce');if(!loop)return 0;
 time(fps);if(compare(fps,ZERO)<=0)throw Error('INVALID_TEXT_ANIMATION_FPS');
 const entrance=animations?.find(a=>a.phase==='in'),exit=animations?.find(a=>a.phase==='out');
 let sample=targetElapsed;
 if(exit&&compare(sample,sub(targetDuration,exit.duration))>=0){
  const outFrame=mul(add(targetStart,sub(targetDuration,exit.duration)),fps),n=BigInt(outFrame.numerator),d=BigInt(outFrame.denominator);
  const lastLoopFrame=(n+d-1n)/d-1n;sample=sub(div(rational(lastLoopFrame),fps),targetStart);
 }
 if(compare(sample,ZERO)<0||entrance&&compare(sample,entrance.duration)<=0)return 0;
 const cycles=div(sub(sample,entrance?.duration??ZERO),loop.duration),d=BigInt(cycles.denominator),n=((BigInt(cycles.numerator)%d)+d)%d;
 // A closed entrance causes the native loop dispatcher to retain the previous
 // interval at exact cycle boundaries; the standalone loop resets at zero.
 if(n===0n)return entrance ? .0025 : 0;
 const six=n*6n,level=six<=d?0:six<=2n*d?1:six<=3n*d?2:six<=4n*d?3:six<=5n*d?2:1;
 return level*.0025;
}

/** 12453543: alternating AE scale tracks. Independent numeric reconstruction;
 * native encoded-pixel and combination parity remain unverified (local adapter).
 */
export function textAnimationGlyphScales(animations:readonly TextAnimation[]|undefined,elapsed:Rational,duration:Rational,fps:Rational,start:Rational=ZERO):[number,number]|undefined{
 const loop=animations?.find(a=>a.phase==='loop'&&a.kind==='alternate-scale');if(!loop)return;
 const entrance=animations?.find(a=>a.phase==='in'),exit=animations?.find(a=>a.phase==='out');
 let sample=elapsed;
 // Product composition: retain last loop pose under the exit's alpha/geometry.
 if(exit&&compare(sample,sub(duration,exit.duration))>=0){
  const edge=mul(add(start,sub(duration,exit.duration)),fps),n=BigInt(edge.numerator),d=BigInt(edge.denominator);
  sample=sub(div(rational((n+d-1n)/d-1n),fps),start);
 }
 if(compare(sample,ZERO)<0||entrance&&compare(sample,entrance.duration)<=0)return;
 const cycle=div(sub(sample,entrance?.duration??ZERO),loop.duration),d=BigInt(cycle.denominator),n=((BigInt(cycle.numerator)%d)+d)%d,t=toNumber(rational(n,d))*1.375;
 const times=[0,.1875,.3125,.8125,1.0625,1.375],values=[1,1.4,1.4,.6,.6,1];
 const controls=[[.03125000000062,1.066666666668,.05625,1.4],[.22916666625,1.4,.27083333375,1.4],[.6625,1.4,.4625,.6],[.8958333325,.6,.9791666675,.6],[1.28125,.6,1.32291666666562,.933333333332]];
 let segment=0;while(segment<4&&t>times[segment+1])segment++;
 const [cx1,cy1,cx2,cy2]=controls[segment],cubic=(a:number,b:number,c:number,d:number,u:number)=>a*(1-u)**3+3*b*(1-u)**2*u+3*c*(1-u)*u*u+d*u**3;
 let low=0,high=1;for(let i=0;i<48;i++){const mid=(low+high)/2;if(cubic(times[segment],cx1,cx2,times[segment+1],mid)>t)high=mid;else low=mid;}
 const odd=t===0?1:values[segment]===values[segment+1]?values[segment]:cubic(values[segment],cy1,cy2,values[segment+1],(low+high)/2);
 return [odd,2-odd];
}
