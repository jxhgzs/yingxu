import {resolveVideoColorSpace} from '../../../../packages/core/src/color-space.ts';
import {renderGraph} from '../../../../packages/media/src/graph.ts';
import type {RenderGraph,Layer} from '../../../../packages/media/src/graph.ts';
import {sourceTimeAt,evaluateAnimation} from '../../../../packages/core/src/animation.ts';
import {transitionWindow,transitionSourceAt} from '../../../../packages/core/src/transitions.ts';
import {defaultTransform} from '../../../../packages/core/src/document.ts';
import type {Document,Asset,Clip,Transform,Diagnostic,Transition,Range} from '../../../../packages/core/src/document.ts';
import {add,sub,compare,decimal,div,frameTime,mul,nearestFrame,toNumber} from '../../../../packages/core/src/time.ts';
import type {Rational} from '../../../../packages/core/src/time.ts';

export type PreviewReason={code:string;message:string;clipId?:string};
export type PreviewSupport={supported:boolean;reasons:PreviewReason[];visualLayers:number;audioLayers:number;maxConcurrentMedia:number};
type PreviewTransition={transition:Transition;outgoing:Layer;incoming:Layer;window:Range};
export type PreviewPlan=RenderGraph&{media:Layer[];previewTransitions:PreviewTransition[];decodeRanges:Map<string,Range>};
export type PlannedVisual=Layer&{sourceTime:Rational;transform:Transform;transition?:{id:string;kind:'crossfade'|'dipToBlack';progress:number;incoming:PlannedVisual}};
export type PlannedFrame={time:Rational;frame:number;layers:PlannedVisual[];audio:Layer[];media:Layer[]};
export type PlanOptions={diagnostics?:Diagnostic[];maxConcurrentMedia?:number};
const knownClipKeys=new Set(['id','materialId','source','target','speed','editableTiming','transform','volume','muted','text','animations','speedCurve','audioFade','colorAdjustments']);
const knownTransitionKeys=new Set(['id','trackId','outgoingClipId','incomingClipId','kind','alignment','overlap','duration']);
function edge(time:Rational,fps:Rational):number{const v=mul(time,fps),n=BigInt(v.numerator),d=BigInt(v.denominator);return Number((n+d-1n)/d);}
export function transitionWeights(kind:'crossfade'|'dipToBlack',progress:number):[number,number,number]{
 const p=Math.max(0,Math.min(1,progress));if(kind==='crossfade')return [1-p,p,0];
 const outgoing=Math.max(1-2*p,0),incoming=Math.max(2*p-1,0);return [outgoing,incoming,1-outgoing-incoming];
}
export function outputTime(value:number|Rational,fps:Rational,mode:'nearest'|'floor'='nearest'):Rational{
 const t=typeof value==='number'?decimal(Math.max(0,Number.isFinite(value)?value:0).toFixed(9)):value;
 if(mode==='nearest')return frameTime(nearestFrame(t,fps).numerator,fps);
 const f=mul(t,fps);return frameTime(BigInt(f.numerator)/BigInt(f.denominator),fps);
}
export function createPreviewPlan(document:Document,options:PlanOptions={}):{support:PreviewSupport;plan?:PreviewPlan}{
 const reasons:PreviewReason[]=[],reason=(code:string,message:string,clipId?:string)=>reasons.push({code,message,...(clipId?{clipId}:{})});
 let graph:RenderGraph;
 try{graph=renderGraph(document);}catch(e){return {support:{supported:false,reasons:[{code:'INVALID_PREVIEW_DOCUMENT',message:(e as Error).message}],visualLayers:0,audioLayers:0,maxConcurrentMedia:0}};}
 for(const d of options.diagnostics||[])reason('UNRESOLVED_DOCUMENT_EFFECT','工程含未解析内容：'+d.code,d.clipId);
 const media=new Map<string,Layer>();for(const l of [...graph.layers,...graph.audio])media.set(l.clip.id,l);
 for(const {clip,asset} of media.values()){
  if((asset.kind||'video')==='video')try{resolveVideoColorSpace(asset);}catch{reason('UNSUPPORTED_VIDEO_COLOR_SPACE','素材色彩格式暂不支持实时预览。',clip.id);}
  if(clip.speedCurve)reason('CURVE_SPEED_REQUIRES_OFFLINE_RENDER','曲线变速需要后台预览。',clip.id);
  if(Object.keys(clip).some(k=>!knownClipKeys.has(k)))reason('UNKNOWN_CLIP_EFFECT','片段含实时预览尚未识别的属性。',clip.id);
  if(asset.kind==='text')reason('TEXT_REQUIRES_OFFLINE_RENDER','文字排版需要后台预览。',clip.id);
  else if(asset.kind!=='audio'&&(!asset.width||!asset.height))reason('MEDIA_DIMENSIONS_REQUIRED','素材尺寸尚未确定。',clip.id);
 }
 const visuals=new Map(graph.layers.map(l=>[l.clip.id,l])),previewTransitions:PreviewTransition[]=[],decodeRanges=new Map([...media.values()].map(l=>[l.clip.id,structuredClone(l.clip.target)]));
 for(const transition of graph.document.transitions||[]){
  const outgoing=visuals.get(transition.outgoingClipId),incoming=visuals.get(transition.incomingClipId);if(!outgoing||!incoming)continue;
  if(Object.keys(transition).some(k=>!knownTransitionKeys.has(k)))reason('UNKNOWN_TRANSITION_EFFECT','转场含实时预览尚未识别的属性。',outgoing.clip.id);
  if(transition.kind!=='crossfade'&&transition.kind!=='dipToBlack'){reason('TRANSITION_KIND_UNSUPPORTED','此转场需要后台预览。',outgoing.clip.id);continue;}
  const window=transitionWindow(transition,outgoing.clip);previewTransitions.push({transition,outgoing,incoming,window});
  if(transition.kind==='crossfade')for(const layer of [outgoing,incoming]){const current=decodeRanges.get(layer.clip.id)!,end=add(current.start,current.duration),windowEnd=add(window.start,window.duration),start=compare(current.start,window.start)<0?current.start:window.start;
   decodeRanges.set(layer.clip.id,{start,duration:sub(compare(end,windowEnd)>0?end:windowEnd,start)});}
 }
 const events=[...decodeRanges.values()].flatMap(range=>[{at:edge(range.start,graph.document.fps),delta:1},{at:edge(add(range.start,range.duration),graph.document.fps),delta:-1}])
  .sort((a,b)=>a.at-b.at||a.delta-b.delta);
 let concurrent=0,maxConcurrentMedia=0;for(const e of events){concurrent+=e.delta;maxConcurrentMedia=Math.max(maxConcurrentMedia,concurrent);}
 if(maxConcurrentMedia>(options.maxConcurrentMedia??12))reason('GPU_MEDIA_CONCURRENCY_LIMIT','同时播放的素材数量超出实时预览限制。');
 const support={supported:reasons.length===0,reasons,visualLayers:graph.layers.length,audioLayers:graph.audio.length,maxConcurrentMedia};
 return {support,...(support.supported?{plan:{...graph,media:[...media.values()],previewTransitions,decodeRanges}}:{})};
}
export function previewFrame(plan:PreviewPlan,time:Rational):PlannedFrame{
 const at=outputTime(time,plan.document.fps,'floor'),f=mul(at,plan.document.fps),frame=Number(BigInt(f.numerator)/BigInt(f.denominator));
 const inRange=(range:Range)=>frame>=edge(range.start,plan.document.fps)&&frame<edge(add(range.start,range.duration),plan.document.fps),active=({clip}:Layer)=>inRange(clip.target);
 const visual=(l:Layer,mode:'normal'|'handles'|'clamp'='normal'):PlannedVisual=>{
  let sourceTime=mode==='handles'?transitionSourceAt(l.clip,at):sourceTimeAt(l.clip,at);const transform={...(l.clip.transform||defaultTransform())};
  if(mode==='clamp'){const end=add(l.clip.source.start,l.clip.source.duration);if(compare(sourceTime,l.clip.source.start)<0)sourceTime=l.clip.source.start;if(compare(sourceTime,end)>0)sourceTime=end;}
  for(const a of l.clip.animations||[])if(a.property!=='volume')transform[a.property]=evaluateAnimation(a,sourceTime);
  return {...l,sourceTime,transform};
 };
 const pairs=new Map<string,PreviewTransition>();for(const t of plan.previewTransitions)if(inRange(t.window)){pairs.set(t.outgoing.clip.id,t);pairs.set(t.incoming.clip.id,t);}
 const emitted=new Set<string>(),layers:PlannedVisual[]=[];
 for(const layer of plan.layers){const pair=pairs.get(layer.clip.id);if(pair){if(emitted.has(pair.transition.id))continue;emitted.add(pair.transition.id);
   const mode=pair.transition.kind==='crossfade'?'handles':'clamp';
   layers.push({...visual(pair.outgoing,mode),transition:{id:pair.transition.id,kind:pair.transition.kind,progress:toNumber(div(sub(at,pair.window.start),pair.window.duration)),incoming:visual(pair.incoming,mode)}});
  }else if(active(layer))layers.push(visual(layer));}
 return {time:at,frame,layers,audio:plan.audio.filter(active),media:plan.media.filter(l=>inRange(plan.decodeRanges.get(l.clip.id)!))};
}
/** Interleaved position(x,y) and top-origin UV(u,v), two triangles, screen clockwise rotation. */
export function layerVertices(asset:Pick<Asset,'width'|'height'>,t:Transform,canvas:{width:number;height:number}):Float32Array{
 const fit=Math.min(canvas.width/asset.width!,canvas.height/asset.height!),even=(v:number)=>Math.max(2,Math.round(v/2)*2);
 const w=even(asset.width!*fit*t.scale),h=even(asset.height!*fit*t.scale),angle=t.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const out:number[]=[];for(const [u,v] of [[0,0],[1,0],[0,1],[0,1],[1,0],[1,1]]){
  const x=(u-.5)*w,y=(v-.5)*h,px=canvas.width/2+t.x+c*x-s*y,py=canvas.height/2+t.y+s*x+c*y;
  out.push(2*px/canvas.width-1,1-2*py/canvas.height,t.flipX?1-u:u,t.flipY?1-v:v);
 }return new Float32Array(out);
}
export function sourceSeekTime(clip:Clip,asset:Asset,time:Rational,fallbackFps:Rational):number{
 const source=toNumber(clip.speedCurve?sourceTimeAt(clip,time):transitionSourceAt(clip,time)),fps=toNumber(asset.fps||fallbackFps);
 return Math.max(0,Math.min(source+Math.min(.0001,.1/fps),toNumber(asset.duration)-.000001));
}
