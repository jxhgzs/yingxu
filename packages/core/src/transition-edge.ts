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
export function reconstructSpatialEdge(lumaRGB:RGB,chromaRGB:RGB,options?:Spatial420Sample):[number,number,number]{if(options)return reconstructSpatial420Pixel(options);const y=rgbTo709(lumaRGB)[0],uv=rgbTo709(chromaRGB);return yuv709ToRgb([y,uv[1],uv[2]]);}
export const spatialEdgeShader=`
const float edgePhase=${SPATIAL_EDGE_PHASE};
const vec3 edgeLuma=vec3(${BT709_LUMA.join(',')});
vec3 edgeToYuv(vec3 rgb){float y=dot(rgb,edgeLuma);return vec3(y,(rgb.b-y)/(2.0*(1.0-edgeLuma.b)),(rgb.r-y)/(2.0*(1.0-edgeLuma.r)));}
vec3 edgeToRgb(vec3 yuv){float r=yuv.x+2.0*(1.0-edgeLuma.r)*yuv.z;float b=yuv.x+2.0*(1.0-edgeLuma.b)*yuv.y;return clamp(vec3(r,(yuv.x-edgeLuma.r*r-edgeLuma.b*b)/edgeLuma.g,b),0.0,1.0);}
bool edgeOutgoing(int kind,vec2 point,vec2 size,float p){return kind==1?point.x<=size.x*(1.0-p):length(point-size*0.5)>=p*length(size)*0.5;}
`;

/** Browser-native420 reconstruction verified separately from its source decoder.
 * v2 is limited to the observed444 source cohort; CPU encoding keeps its prior
 * policy until a new encoded candidate also satisfies the existing maxima. */
export const SPATIAL_RECONSTRUCTION='centered-bilinear444-v2' as const;
export const SPATIAL_CHROMA_KERNEL=[1,3,3,1] as const;
export type SpatialReconstruction=typeof SPATIAL_RECONSTRUCTION;
export function spatialReconstruction(doc:Document,transition:Transition):SpatialReconstruction|undefined{
 if(!spatialEdgePolicy(doc,transition))return;
 const ids=new Set(doc.tracks.flatMap(t=>t.clips).filter(c=>c.id===transition.outgoingClipId||c.id===transition.incomingClipId).map(c=>c.materialId));
 return [...ids].every(id=>doc.assets.find(a=>a.id===id)?.pixelFormat==='yuv444p')?SPATIAL_RECONSTRUCTION:undefined;
}
export type Spatial420Sample={kind:'wipeLeft'|'circleOpen';progress:number;x:number;y:number;width:number;height:number;sample:(side:'outgoing'|'incoming',x:number,y:number)=>RGB};
export function reconstructSpatial420Pixel(options:Spatial420Sample):[number,number,number]{
 const {kind,progress,x,y,width,height,sample}=options,side=(px:number,py:number)=>spatialOutgoing(kind,px,py,width,height,progress)?'outgoing':'incoming';
 const luma=rgbTo709(sample(side(x+.5,y+.5),x,y))[0],Y=(Math.floor(luma*219+16+.5)-16)/219;
 const fx=(x-.5)/2,fy=(y-.5)/2,ix=Math.floor(fx),iy=Math.floor(fy),dx=fx-ix,dy=fy-iy;let U=0,V=0;
 for(let cy=0;cy<2;cy++)for(let cx=0;cx<2;cx++){
  const ux=Math.max(0,Math.min(width/2-1,ix+cx)),uy=Math.max(0,Math.min(height/2-1,iy+cy)),which=side(2*ux+.5,2*uy+.5),rgb=[0,0,0] as [number,number,number];
  for(let ky=0;ky<4;ky++)for(let kx=0;kx<4;kx++){
   const color=sample(which,Math.max(0,Math.min(width-1,2*ux+kx-1)),Math.max(0,Math.min(height-1,2*uy+ky-1))),weight=SPATIAL_CHROMA_KERNEL[kx]*SPATIAL_CHROMA_KERNEL[ky]/64;
   for(let c=0;c<3;c++)rgb[c]+=color[c]*weight;
  }
  const uv=rgbTo709(rgb),weight=(cx?dx:1-dx)*(cy?dy:1-dy);U+=(Math.floor(uv[1]*224+128+.5)-128)/224*weight;V+=(Math.floor(uv[2]*224+128+.5)-128)/224*weight;
 }
 return yuv709ToRgb([Y,U,V]);
}
export const spatialChromaShader=`
vec3 filteredSource(bool outgoing,ivec2 anchor){
 vec3 sum=vec3(0.0);const float weights[4]=float[4](${SPATIAL_CHROMA_KERNEL.map(v=>v+'.0').join(',')});
 for(int y=0;y<4;y++)for(int x=0;x<4;x++){
  ivec2 p=clamp(anchor+ivec2(x-1,y-1),ivec2(0),ivec2(1279,719));p.y=719-p.y;
  vec3 rgb=outgoing?texelFetch(u_outgoing,p,0).rgb:texelFetch(u_incoming,p,0).rgb;sum+=rgb*weights[x]*weights[y];
 }return sum/64.0;
}
`;
