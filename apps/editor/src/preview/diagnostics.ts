import type {DecodedMedia} from './decode.ts';
import type {ColorReadback,PreviewColorState} from './color.ts';
export type DecodedColorSample={clipId:string;kind:string;currentTime?:number;decodedMediaTime?:number;width:number;height:number;videoColorSpace?:{primaries:string|null;transfer:string|null;matrix:string|null;fullRange:boolean|null};centerCanvasSrgb?:number[];canvasColorSpace?:string;error?:string};
export type PreviewColorDiagnostic={version:1;time:number;frame:number;state:PreviewColorState;passes:ColorReadback[];sources:DecodedColorSample[];notice:string};

/** Decoded-source observation only: no new URL loads, no seek, no DOM insertion. */
export function decodedColorSample(resource:DecodedMedia):DecodedColorSample|undefined{
 const source=resource.pixels;if(!source)return;
 const video=source instanceof HTMLVideoElement?source:undefined,width=video?.videoWidth||(source as HTMLImageElement).naturalWidth,height=video?.videoHeight||(source as HTMLImageElement).naturalHeight;
 const sample:DecodedColorSample={clipId:resource.id,kind:resource.asset.kind??'video',currentTime:resource.media?.currentTime,decodedMediaTime:resource.decodedTime,width,height};
 if(video&&typeof VideoFrame!=='undefined'){
  try{
   const frame=new VideoFrame(video);try{const space=frame.colorSpace;sample.videoColorSpace={primaries:space.primaries,transfer:space.transfer,matrix:space.matrix,fullRange:space.fullRange};}finally{frame.close();}
  }catch(error){sample.error=(error as Error).message;}
 }
 try{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});if(!context)throw Error('CANVAS_2D_UNAVAILABLE');
  context.drawImage(source,Math.floor(width/2),Math.floor(height/2),1,1,0,0,1,1);const image=context.getImageData(0,0,1,1);sample.centerCanvasSrgb=[...image.data];sample.canvasColorSpace=image.colorSpace;
 }catch(error){sample.error=(error as Error).message;}
 return sample;
}
