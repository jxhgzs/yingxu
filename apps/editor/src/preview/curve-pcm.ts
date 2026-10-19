/** Raw target-clock PCM. Volume automation and fades belong to PreviewAudio. */
export type CurvePcm={sampleRate:number;sampleCount:number;channels:[Float32Array,Float32Array];bytes:number};
export const CURVE_PCM_MAX_BYTES=32*1024*1024;
const floatGuid=[3,0,0,0,0,0,16,0,128,0,0,170,0,56,155,113];
function invalid():never{throw Error('CURVE_PCM_INVALID');}
/** Parse the bounded little-endian float WAV contract without creating an AudioContext. */
export function parseCurveWav(input:ArrayBuffer,expected:{sampleRate:number;sampleCount:number}):CurvePcm{
 if(!(input instanceof ArrayBuffer)||!expected||expected.sampleRate!==44100||!Number.isSafeInteger(expected.sampleCount)||expected.sampleCount<1||expected.sampleCount*8>CURVE_PCM_MAX_BYTES)invalid();
 if(input.byteLength<44||input.byteLength>CURVE_PCM_MAX_BYTES+65536)invalid();
 const view=new DataView(input),id=(at:number)=>String.fromCharCode(...new Uint8Array(input,at,4));
 if(id(0)!=='RIFF'||id(8)!=='WAVE'||view.getUint32(4,true)!==input.byteLength-8)invalid();
 let fmt=false,data=-1,dataBytes=0,fact=false;
 for(let at=12;at<input.byteLength;){
  if(at+8>input.byteLength)invalid();
  const name=id(at),size=view.getUint32(at+4,true),body=at+8,end=body+size;
  if(end>input.byteLength||end+(size&1)>input.byteLength)invalid();
  if(name==='fmt '){
   if(fmt||size<16)invalid();fmt=true;
   const tag=view.getUint16(body,true);
   if(view.getUint16(body+2,true)!==2||view.getUint32(body+4,true)!==44100||view.getUint32(body+8,true)!==352800||view.getUint16(body+12,true)!==8||view.getUint16(body+14,true)!==32)invalid();
   if(tag===3){if(size!==16&&(size!==18||view.getUint16(body+16,true)!==0))invalid();}
   else if(tag===65534){
    if(size!==40||view.getUint16(body+16,true)!==22||view.getUint16(body+18,true)!==32||![0,3].includes(view.getUint32(body+20,true)))invalid();
    for(let i=0;i<16;i++)if(view.getUint8(body+24+i)!==floatGuid[i])invalid();
   }else invalid();
  }else if(name==='data'){
   if(data!==-1||size!==expected.sampleCount*8)invalid();data=body;dataBytes=size;
  }else if(name==='fact'){
   if(fact||size!==4||view.getUint32(body,true)!==expected.sampleCount)invalid();fact=true;
  }
  at=end+(size&1);
 }
 if(!fmt||data===-1)invalid();
 // Validate before allocating both planar channels, and read LE explicitly.
 for(let at=data;at<data+dataBytes;at+=4)if(!Number.isFinite(view.getFloat32(at,true)))invalid();
 const channels:[Float32Array,Float32Array]=[new Float32Array(expected.sampleCount),new Float32Array(expected.sampleCount)];
 for(let i=0;i<expected.sampleCount;i++){channels[0][i]=view.getFloat32(data+i*8,true);channels[1][i]=view.getFloat32(data+i*8+4,true);}
 return {sampleRate:44100,sampleCount:expected.sampleCount,channels,bytes:dataBytes};
}
