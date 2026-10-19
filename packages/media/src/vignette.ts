import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {vignetteParameters,validateVignette} from '../../core/src/vignette.ts';
import type {Vignette} from '../../core/src/vignette.ts';
/** A bounded source-space 16-bit mask, evaluated once rather than per frame. */
export async function prepareVignette(value:Vignette|undefined,width:number,height:number,directory:string,signal?:AbortSignal):Promise<{path:string;mode:'multiply'|'screen'}|undefined>{
 if(!value)return;validateVignette(value);if(!value.intensity)return;
 if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=16384)||width*height>16*1024*1024)throw Error('VIGNETTE_SOURCE_SIZE_LIMIT');
 signal?.throwIfAborted();const p=vignetteParameters(value.intensity),pixels=Buffer.alloc(width*height*2);
 for(let y=0;y<height;y++){if(y%64===0){signal?.throwIfAborted();await new Promise<void>(resolve=>setImmediate(resolve));}
  for(let x=0;x<width;x++){const d=Math.hypot(2*(x+.5)/width-1,2*(y+.5)/height-1),q=Math.max(0,Math.min(1,(d-p.inner)/(p.outer-p.inner))),mix=q*q*(3-2*q),value=p.mode==='darken'?1-mix*p.amount:mix;pixels.writeUInt16BE(Math.round(value*65535),(y*width+x)*2);}
 }
 const key=createHash('sha256').update(JSON.stringify({value,width,height})).digest('hex'),file=path.join(directory,'vignette-'+key+'.pgm');
 await fs.writeFile(file,Buffer.concat([Buffer.from(`P5\n${width} ${height}\n65535\n`),pixels]),{signal});return {path:file,mode:p.mode==='darken'?'multiply':'screen'};
}
