import {WebGLCompositor} from '../../../apps/editor/src/preview/webgl.ts';
import {applyColorAdjustments} from '../../../packages/core/src/color-effects.ts';
import {defaultTransform} from '../../../packages/core/src/document.ts';
import type {ColorAdjustments} from '../../../packages/core/src/color-effects.ts';
import {rational} from '../../../packages/core/src/time.ts';
const run=document.querySelector('#run') as HTMLButtonElement,result=document.querySelector('#result')!,canvas=document.querySelector('#preview') as HTMLCanvasElement;
run.onclick=async()=>{try{
 const size=64,pixels=new Uint8ClampedArray(size*size*4);for(let i=0;i<size*size;i++){pixels.set([i%256,(i*37)%256,(i*113)%256,255],i*4);}for(let i=0;i<256;i++)pixels.set([i,i,i,255],i*4);
 const source=document.createElement('canvas');source.width=size;source.height=size;source.getContext('2d')!.putImageData(new ImageData(pixels,size,size),0,0);const image=new Image();image.src=source.toDataURL();await image.decode();
 const compositor=new WebGLCompositor(canvas);compositor.resize(size,size);const gl=compositor.gl;
 const asset={id:'own-rgb-grid',kind:'image' as const,path:'generated',duration:rational(1),width:size,height:size};const clip={id:'grid',materialId:asset.id,source:{start:rational(0),duration:rational(1)},target:{start:rational(0),duration:rational(1)},speed:rational(1),editableTiming:true};
 const cases=[{},...[-1,-.5,-.00002,.00002,.1,.5,.7,1].map(contrast=>({contrast})),{brightness:1,contrast:1},{brightness:.6,contrast:-.5},{brightness:-.6,contrast:.7,saturation:.5,highlight:.4,shadow:-.3},{brightness:.8,contrast:1,saturation:.8,highlight:-1,shadow:-1}],rows=[];
 for(const fields of cases){const adjustment:ColorAdjustments={version:'combine-adjust-v2',...fields},layer={clip:{...clip,colorAdjustments:adjustment},asset,sourceTime:rational(0),transform:defaultTransform()};compositor.draw([layer],new Map([['grid',{asset,state:'ready',pixels:image} as any]]),{width:size,height:size});const actual=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,actual);if(gl.getError()!==gl.NO_ERROR)throw Error('read failed');let max=0,total=0,fail=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4,j=((size-1-y)*size+x)*4,expected=applyColorAdjustments([pixels[i]/255,pixels[i+1]/255,pixels[i+2]/255],adjustment);for(let c=0;c<3;c++){const error=Math.abs(actual[j+c]-expected[c]*255);max=Math.max(max,error);total+=error;if(error>.501)fail++;}if(actual[j+3]!==255)throw Error('alpha');}rows.push({fields,maxErrorLSB:max,meanErrorLSB:total/(size*size*3),overHalfLSB:fail});}
 const report={renderer:compositor.info,width:size,height:size,pixelsPerCase:size*size,cases:rows,pass:rows.every(r=>r.maxErrorLSB<.502)};compositor.dispose();result.textContent=JSON.stringify(report,null,2);await fetch('./result',{method:'POST',body:JSON.stringify(report)});
 }catch(e){result.textContent=String(e);}};
