/** Recover libass RGB coverage using the same black/white observations for scalar and batch paths. */
export function recoverTextRGBA(black:Buffer,white:Buffer,pixels=Buffer.alloc(black.length)):Buffer{
 if(black.length!==white.length||pixels.length!==black.length||black.length%4)throw Error('TEXT_RASTER_PIXELS_INVALID');
 pixels.fill(0);
 for(let i=0;i<black.length;i+=4){
  const alpha=255-Math.round(((white[i]-black[i])+(white[i+1]-black[i+1])+(white[i+2]-black[i+2]))/3);
  pixels[i+3]=Math.max(0,Math.min(255,alpha));
  if(alpha>0)for(let c=0;c<3;c++)pixels[i+c]=Math.max(0,Math.min(255,Math.round(black[i+c]*255/alpha)));
 }
 return pixels;
}
