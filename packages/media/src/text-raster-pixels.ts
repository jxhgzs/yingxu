const littleEndian=new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]===4;
const rgbMask=littleEndian?0x00ffffff:0xffffff00;
/** Recover libass RGB coverage using the same black/white observations for scalar and batch paths. */
export function recoverTextRGBA(black:Buffer,white:Buffer,pixels=Buffer.alloc(black.length)):Buffer{
 if(black.length!==white.length||pixels.length!==black.length||black.length%4)throw Error('TEXT_RASTER_PIXELS_INVALID');
 const aligned=black.byteOffset%4===0&&white.byteOffset%4===0&&pixels.byteOffset%4===0;
 const b=aligned?new Uint32Array(black.buffer,black.byteOffset,black.length/4):undefined,w=aligned?new Uint32Array(white.buffer,white.byteOffset,white.length/4):undefined,p=aligned?new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length/4):undefined;
 for(let i=0;i<black.length;i+=4){
  // Most full-canvas pixels are uncovered. Inspect exactly the RGB observations,
  // ignoring source alpha just like the general recovery below.
  if(b&&w&&p?(b[i/4]&rgbMask)===0&&((w[i/4]&rgbMask)>>>0)===(rgbMask>>>0):black[i]===0&&black[i+1]===0&&black[i+2]===0&&white[i]===255&&white[i+1]===255&&white[i+2]===255){
   if(p)p[i/4]=0;else pixels.fill(0,i,i+4);continue;
  }
  const alpha=255-Math.round(((white[i]-black[i])+(white[i+1]-black[i+1])+(white[i+2]-black[i+2]))/3);
  pixels[i+3]=Math.max(0,Math.min(255,alpha));
  if(alpha>0)for(let c=0;c<3;c++)pixels[i+c]=Math.max(0,Math.min(255,Math.round(black[i+c]*255/alpha)));
  else pixels[i]=pixels[i+1]=pixels[i+2]=0;
 }
 return pixels;
}
