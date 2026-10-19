/**
 * Target-clock interpretation of the individually verified Jianying 5.9 text
 * presets: 1644304 (appear), 1644600 (disappear), 1644275 (typewriter I),
 * 1644514 (loop flash).
 * Resource source stays outside the product. Evidence and remaining glyph and
 * encoded-pixel differences: docs/qa/2026-10-19-rea-text-animation.md.
 */
import {add,compare,div,mul,rational,sub,toNumber,ZERO} from './time.ts';
import type {Rational} from './time.ts';

export type TextAnimation={phase:'in'|'out'|'loop';kind:'fade'|'typewriter'|'flash';duration:Rational};

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
    if(v.phase==='loop'?v.kind!=='flash':v.kind!=='fade'&&(v.kind!=='typewriter'||v.phase!=='in'))throw Error('TEXT_ANIMATION_KIND_UNVERIFIED');
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
      return entrance.kind==='fade'?p*(2-p):1;
    }
    if(exit&&compare(targetElapsed,sub(targetDuration,exit.duration))>=0){
      const p=progress(sub(targetElapsed,sub(targetDuration,exit.duration)),exit.duration);
      return (1-p)*(1-p);
    }
    const elapsed=sub(targetElapsed,entrance?.duration??ZERO);
    const cycles=div(elapsed,loop.duration);
    const denominator=BigInt(cycles.denominator);
    const remainder=((BigInt(cycles.numerator)%denominator)+denominator)%denominator;
    const r=toNumber(rational(remainder,denominator));
    return r<=.5?4*r*(1-r):1-(2*r-1)*(2*r-1);
  }
  let opacity=1;
  for(const animation of animations??[]){
    if(animation.kind!=='fade')continue;
    const elapsed=animation.phase==='in'?targetElapsed:sub(targetElapsed,sub(targetDuration,animation.duration));
    const p=progress(elapsed,animation.duration);
    opacity*=animation.phase==='in'?p*(2-p):(1-p)*(1-p);
  }
  return opacity;
}

/**
 * Conservative renderable-glyph policy, separate from structural validation.
 * ASCII spaces and LF line breaks count as entries, established by the native
 * mixed multiline probe. Combining and supplementary codepoints stay unknown.
 */
export function canRenderTextAnimationText(text:string):boolean{
  return typeof text==='string'&&text.length>0&&text.length<=2000&&/^[\n\u0020-\u007e\u4e00-\u9fff]+$/u.test(text);
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
