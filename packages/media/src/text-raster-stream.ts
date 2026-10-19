import {pipeline} from 'node:stream/promises';
import type {Writable} from 'node:stream';
import {recoverTextRGBA} from './text-raster-pixels.ts';
/** Paired full-canvas black/white frames. Backpressure bounds live recovery to one pair and one output. */
export async function recoverTextFrameStream(source:AsyncIterable<Uint8Array>,destination:Writable,frameBytes:number,frames:number,signal?:AbortSignal){
 if(!Number.isSafeInteger(frameBytes)||frameBytes<=0||frameBytes%4||frameBytes>1920*1080*4||!Number.isSafeInteger(frames)||frames<=0||frames>32||frameBytes*frames>128*1024*1024)throw Error('TEXT_RASTER_PIXELS_INVALID');
 const pair=Buffer.allocUnsafe(frameBytes*2);let offset=0,completed=0;
 try{await pipeline(source,async function*(chunks){
  for await(const chunk of chunks){if(signal?.aborted)throw Error('JOB_CANCELLED');let consumed=0;
   while(consumed<chunk.length){if(completed>=frames)throw Error('TEXT_RASTER_PIXELS_INVALID');const count=Math.min(pair.length-offset,chunk.length-consumed);pair.set(chunk.subarray(consumed,consumed+count),offset);offset+=count;consumed+=count;
    if(offset===pair.length){if(signal?.aborted)throw Error('JOB_CANCELLED');yield recoverTextRGBA(pair.subarray(0,frameBytes),pair.subarray(frameBytes));completed++;offset=0;}
   }
  }
  if(offset||completed!==frames)throw Error('TEXT_RASTER_PIXELS_INVALID');
 },destination,{signal});}catch(error){if(signal?.aborted)throw Error('JOB_CANCELLED');throw error;}
}
