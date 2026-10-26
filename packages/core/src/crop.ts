import {check} from './document.ts';
export type Crop={x:number;y:number;width:number;height:number};
export function validateCrop(crop:Crop){check(crop&&Object.keys(crop).every(k=>['x','y','width','height'].includes(k))&&[crop.x,crop.y,crop.width,crop.height].every(Number.isFinite)&&crop.x>=0&&crop.y>=0&&crop.width>=.001&&crop.height>=.001&&crop.x+crop.width<=1.000000001&&crop.y+crop.height<=1.000000001,'INVALID_CROP');}
export function cropPixels(asset:{width?:number;height?:number},crop?:Crop){
 const width=asset.width!,height=asset.height!;check(Number.isInteger(width)&&width>=1&&Number.isInteger(height)&&height>=1,'INVALID_CROP_SOURCE');
 if(!crop)return {x:0,y:0,width,height};check(width>=2&&height>=2,'INVALID_CROP_SOURCE');validateCrop(crop);
 const x=Math.min(width-2,Math.round(crop.x*width)),y=Math.min(height-2,Math.round(crop.y*height));
 return {x,y,width:Math.min(width-x,Math.max(2,Math.round(crop.width*width))),height:Math.min(height-y,Math.max(2,Math.round(crop.height*height)))};
}
