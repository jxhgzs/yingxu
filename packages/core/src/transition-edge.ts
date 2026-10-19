import type {Document,Transition} from './document.ts';
import {defaultTransform} from './document.ts';
import {resolveVideoColorSpace} from './color-space.ts';
import {compare,rational} from './time.ts';
import {isOpaqueVideoPixelFormat} from './video-pixels.ts';
import {isSpatialTransition} from './transitions.ts';

/** Independent model of the observed 720p30 opaque two-video fixture. Not a
 * recovered native implementation. Other compositions retain RGBA blending. */
export const SPATIAL_EDGE_POLICY='bt709-cosited420-v1' as const;
export const SPATIAL_EDGE_PHASE=.5;
export type SpatialEdgePolicy=typeof SPATIAL_EDGE_POLICY;
export function spatialEdgePolicy(doc:Document,transition:Transition):SpatialEdgePolicy|undefined{
 if(!isSpatialTransition(transition.kind)||doc.canvas.width!==1280||doc.canvas.height!==720||compare(doc.fps,rational(30))!==0||doc.transitions?.length!==1)return;
 const visual=doc.tracks.filter(t=>!t.hidden&&t.kind!=='audio').flatMap(t=>t.clips);
 if(visual.length!==2||!visual.some(c=>c.id===transition.outgoingClipId)||!visual.some(c=>c.id===transition.incomingClipId))return;
 for(const clip of visual){
  const asset=doc.assets.find(a=>a.id===clip.materialId),transform=clip.transform||defaultTransform();
  if(!asset||asset.kind!=='video'||asset.verifiedDisplayTransform!=='identity'||!isOpaqueVideoPixelFormat(asset.pixelFormat)||asset.width!==1280||asset.height!==720||compare(clip.speed,rational(1))!==0||clip.speedCurve||clip.textAnimations?.length||clip.animations?.some(a=>a.property!=='volume'))return;
  if(Object.entries(defaultTransform()).some(([key,value])=>transform[key as keyof typeof transform]!==value))return;
  if(clip.colorAdjustments&&Object.entries(clip.colorAdjustments).some(([key,value])=>key!=='version'&&value!==0&&value!==undefined))return;
  // The vignette field is independently versioned; its nonzero spatial colour
  // interaction has no native transition evidence in this policy.
  if((clip as typeof clip&{vignette?:{intensity:number}}).vignette?.intensity)return;
  try{const color=resolveVideoColorSpace(asset);if(color.matrix!=='bt709'||color.primaries!=='bt709'||color.transfer!=='bt709'||color.range!=='tv')return;}catch{return;}
 }
 return SPATIAL_EDGE_POLICY;
}
/** x/y are full-resolution pixel centres, also for the subsampled UV plane. */
export function spatialOutgoing(kind:'wipeLeft'|'circleOpen',x:number,y:number,width:number,height:number,progress:number):boolean{
 const p=Math.max(0,Math.min(1,progress));return kind==='wipeLeft'?x<=width*(1-p):Math.hypot(x-width/2,y-height/2)>=p*Math.hypot(width,height)/2;
}
export function spatialChromaAnchor(x:number,y:number):[number,number]{return [Math.floor(x/2)*2+SPATIAL_EDGE_PHASE,Math.floor(y/2)*2+SPATIAL_EDGE_PHASE];}
export function spatialPlaneMask(kind:'wipeLeft'|'circleOpen',width:number,height:number,progress:string,plane:0|1|2):string{
 const factor=plane===0?1:2,x=`${factor}*X+${SPATIAL_EDGE_PHASE}`,y=`${factor}*Y+${SPATIAL_EDGE_PHASE}`;
 return kind==='wipeLeft'?`lte(${x},${width}*(1-(${progress})))`:`gte(hypot(${x}-${width/2},${y}-${height/2}),(${progress})*hypot(${width},${height})/2)`;
}
export const BT709_LUMA=[.2126,.7152,.0722] as const;
type RGB=readonly [number,number,number];
export function rgbTo709(rgb:RGB):[number,number,number]{const y=rgb.reduce((s,v,i)=>s+v*BT709_LUMA[i],0);return [y,(rgb[2]-y)/(2*(1-BT709_LUMA[2])),(rgb[0]-y)/(2*(1-BT709_LUMA[0]))];}
export function yuv709ToRgb(yuv:RGB):[number,number,number]{const [y,u,v]=yuv,r=y+2*(1-BT709_LUMA[0])*v,b=y+2*(1-BT709_LUMA[2])*u,g=(y-BT709_LUMA[0]*r-BT709_LUMA[2]*b)/BT709_LUMA[1];return [r,g,b].map(c=>Math.max(0,Math.min(1,c))) as [number,number,number];}
/** GPU changes only cross-side chroma pixels; its already decoded RGB sources
 * are preserved elsewhere. CPU keeps YUV until encoding, avoiding RGB clipping. */
export function reconstructSpatialEdge(lumaRGB:RGB,chromaRGB:RGB):[number,number,number]{const y=rgbTo709(lumaRGB)[0],uv=rgbTo709(chromaRGB);return yuv709ToRgb([y,uv[1],uv[2]]);}
export const spatialEdgeShader=`
const float edgePhase=${SPATIAL_EDGE_PHASE};
const vec3 edgeLuma=vec3(${BT709_LUMA.join(',')});
vec3 edgeToYuv(vec3 rgb){float y=dot(rgb,edgeLuma);return vec3(y,(rgb.b-y)/(2.0*(1.0-edgeLuma.b)),(rgb.r-y)/(2.0*(1.0-edgeLuma.r)));}
vec3 edgeToRgb(vec3 yuv){float r=yuv.x+2.0*(1.0-edgeLuma.r)*yuv.z;float b=yuv.x+2.0*(1.0-edgeLuma.b)*yuv.y;return clamp(vec3(r,(yuv.x-edgeLuma.r*r-edgeLuma.b*b)/edgeLuma.g,b),0.0,1.0);}
bool edgeOutgoing(int kind,vec2 point,vec2 size,float p){return kind==1?point.x<=size.x*(1.0-p):length(point-size*0.5)>=p*length(size)*0.5;}
`;
