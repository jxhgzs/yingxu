import type {Clip} from '../../core/src/document.ts';
import type {AnimatedProperty} from '../../core/src/animation.ts';
import type {Rational} from '../../core/src/time.ts';
import {evaluateAnimation,sourceTimeAt} from '../../core/src/animation.ts';
export const fraction=(t:Rational)=>`(${t.numerator}/${t.denominator})`;
/** timeExpression is in source coordinates, never a target-local clock. */
export function animationExpression(clip:Clip,property:AnimatedProperty,timeExpression:string,fallback:number):string{
  const points=clip.animations?.find(a=>a.property===property)?.points;
  if(!points?.length)return String(fallback);
  let expression=String(points.at(-1)!.value);
  for(let i=points.length-2;i>=0;i--){
    const a=points[i],b=points[i+1];
    const value=a.interpolation==='hold'?String(a.value):`(${a.value}+(${timeExpression}-${fraction(a.time)})/(${fraction(b.time)}-${fraction(a.time)})*(${b.value-a.value}))`;
    expression=`if(lt(${timeExpression},${fraction(b.time)}),${value},${expression})`;
  }
  return `if(lte(${timeExpression},${fraction(points[0].time)}),${points[0].value},${expression})`;
}
export function animatedValue(clip:Clip,property:AnimatedProperty,targetTime:Rational,fallback:number):number{
  const a=clip.animations?.find(a=>a.property===property);return a?evaluateAnimation(a,sourceTimeAt(clip,targetTime)):fallback;
}
export function maxAnimatedValue(clip:Clip,property:AnimatedProperty,fallback:number):number{
  const a=clip.animations?.find(a=>a.property===property);return a?Math.max(...a.points.map(p=>p.value)):fallback;
}
