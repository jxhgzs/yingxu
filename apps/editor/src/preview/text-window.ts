import type {Layer} from '../../../../packages/media/src/graph.ts';
import {add,mul} from '../../../../packages/core/src/time.ts';
import type {Rational} from '../../../../packages/core/src/time.ts';
import {textRasterMode} from './plan.ts';
import type {TextFrameRequest} from './text-cache.ts';
const ceilFrame=(time:Rational,fps:Rational)=>{const n=mul(time,fps);return Number((BigInt(n.numerator)+BigInt(n.denominator)-1n)/BigInt(n.denominator));};
type Window={layer:Layer;first:number;end:number;mode?:'neutral'|'frame';order:number};
/** Frame-ordered requests without evaluating the complete render graph 300 times per tick. */
export class TextFrameWindows{
 private windows:Window[];
 constructor(layers:readonly Layer[],fps:Rational){this.windows=layers.filter(l=>l.asset.kind==='text').map((layer,order)=>({layer,order,first:ceilFrame(layer.clip.target.start,fps),end:ceilFrame(add(layer.clip.target.start,layer.clip.target.duration),fps),mode:textRasterMode(layer.clip)}));}
 at(start:number,capacity:number,horizon=300):TextFrameRequest[]{
  const candidates=this.windows.filter(w=>w.end>start&&w.first<start+horizon).map(w=>({...w,next:Math.max(start,w.first)})),out:TextFrameRequest[]=[];
  const compare=(a:{next:number;order:number},b:{next:number;order:number})=>a.next-b.next||a.order-b.order;candidates.sort(compare);
  while(candidates.length&&out.length<capacity){const current=candidates.shift()!,{layer,mode}=current;out.push({clipId:layer.clip.id,asset:layer.asset,...(mode?{mode}:{}),...(mode==='frame'?{frame:current.next}:{})});
   if(mode==='frame'&&++current.next<Math.min(current.end,start+horizon)){
    let left=0,right=candidates.length;while(left<right){const middle=(left+right)>>>1;if(compare(candidates[middle],current)<=0)left=middle+1;else right=middle;}candidates.splice(left,0,current);
   }
  }
  return out;
 }
}
