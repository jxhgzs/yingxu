import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCurveWav,CURVE_PCM_MAX_BYTES} from '../apps/editor/src/preview/curve-pcm.ts';
import {PreviewAudio,audioGainAt} from '../apps/editor/src/preview/audio.ts';
import {sourceTimeAt} from '../packages/core/src/animation.ts';
import {rational,decimal,toNumber} from '../packages/core/src/time.ts';
import type {Clip} from '../packages/core/src/document.ts';

function wav(values:number[],extensible=false){
 const fmt=extensible?40:16,n=values.length/2,fmtEnd=20+fmt,bytes=new ArrayBuffer(fmtEnd+12+8+values.length*4),v=new DataView(bytes),tag=(at:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 tag(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,fmt,true);v.setUint16(20,extensible?65534:3,true);v.setUint16(22,2,true);v.setUint32(24,44100,true);v.setUint32(28,352800,true);v.setUint16(32,8,true);v.setUint16(34,32,true);
 if(extensible){v.setUint16(36,22,true);v.setUint16(38,32,true);v.setUint32(40,3,true);new Uint8Array(bytes,44,16).set([3,0,0,0,0,0,16,0,128,0,0,170,0,56,155,113]);}
 tag(fmtEnd,'fact');v.setUint32(fmtEnd+4,4,true);v.setUint32(fmtEnd+8,n,true);tag(fmtEnd+12,'data');v.setUint32(fmtEnd+16,values.length*4,true);values.forEach((x,i)=>v.setFloat32(fmtEnd+20+4*i,x,true));
 return bytes;
}
const expected={sampleRate:44100,sampleCount:3};
test('float and extensible float WAV parse LE stereo without altering amplitude or allocating AudioContext',()=>{
 const original=globalThis.AudioContext;Object.assign(globalThis,{AudioContext:class{constructor(){throw Error('must remain lazy');}}});
 try{for(const ext of [false,true]){const input=wav([.5,-.25,0,-0,2,-2],ext),out=parseCurveWav(input,expected);assert.equal(out.sampleRate,44100);assert.equal(out.sampleCount,3);assert.equal(out.bytes,24);assert.deepEqual([...out.channels[0]],[.5,0,2]);assert.deepEqual([...out.channels[1]],[-.25,-0,-2]);new DataView(input).setFloat32(input.byteLength-4,0,true);assert.equal(out.channels[1][2],-2,'parsed channels must own their memory');}}
 finally{Object.assign(globalThis,{AudioContext:original});}
});
test('FFmpeg fmt18 float WAV, optional metadata and odd padded chunks obey the same contract',()=>{
 const original=wav([.5,-.25,0,-0,2,-2]),input=new ArrayBuffer(original.byteLength+2+12),out=new Uint8Array(input),v=new DataView(input);
 out.set(new Uint8Array(original,0,36));out.set(new Uint8Array(original,36),38);v.setUint32(4,input.byteLength-8,true);v.setUint32(16,18,true);v.setUint16(36,0,true);
 const end=original.byteLength+2;out.set(new TextEncoder().encode('LIST'),end);v.setUint32(end+4,3,true);out.set([1,2,3,0],end+8);
 assert.deepEqual([...parseCurveWav(input,expected).channels[0]],[.5,0,2]);v.setUint16(36,1,true);assert.throws(()=>parseCurveWav(input,expected),/CURVE_PCM_INVALID/);
 // A second fmt or data declaration must never override the checked contract.
 for(const name of ['fmt ','data']){const body=wav([1,2,3,4,5,6]),copy=new ArrayBuffer(body.byteLength+8),bytes=new Uint8Array(copy),view=new DataView(copy);bytes.set(new Uint8Array(body));bytes.set(new TextEncoder().encode(name),body.byteLength);view.setUint32(4,copy.byteLength-8,true);assert.throws(()=>parseCurveWav(copy,expected),/CURVE_PCM_INVALID/);}
});
test('WAV rejects truncated/misdeclared data, unsupported formats, bad metadata and nonfinite samples',()=>{
 const reject=(alter:(v:DataView)=>void,ext=false)=>{const input=wav([1,2,3,4,5,6],ext);alter(new DataView(input));assert.throws(()=>parseCurveWav(input,expected),/CURVE_PCM_INVALID/);};
 reject(v=>v.setUint8(0,0));reject(v=>v.setUint32(4,1,true));reject(v=>v.setUint16(20,1,true));reject(v=>v.setUint16(22,1,true));reject(v=>v.setUint32(24,48000,true));reject(v=>v.setUint32(28,1,true));reject(v=>v.setUint16(32,4,true));reject(v=>v.setUint16(34,16,true));
 reject(v=>v.setUint16(36,20,true),true);reject(v=>v.setUint16(38,24,true),true);reject(v=>v.setUint8(44,1),true);reject(v=>v.setUint32(40,4,true),true);reject(v=>v.setUint32(44,4,true));reject(v=>v.setUint32(52,16,true));
 for(const bad of [NaN,Infinity,-Infinity])reject(v=>v.setFloat32(v.byteLength-4,bad,true));
 const valid=wav([1,2,3,4,5,6]);assert.throws(()=>parseCurveWav(valid.slice(0,-1),expected),/CURVE_PCM_INVALID/);
 for(const exp of [{sampleRate:48000,sampleCount:3},{sampleRate:44100,sampleCount:2},{sampleRate:44100,sampleCount:1.5},{sampleRate:44100,sampleCount:CURVE_PCM_MAX_BYTES/8+1}])assert.throws(()=>parseCurveWav(valid,exp),/CURVE_PCM_INVALID/);
});

class Param {value=0;values?:Float32Array;cancelAndHoldAtTime(){}cancelScheduledValues(){}setValueAtTime(value:number){this.value=value;}setValueCurveAtTime(values:Float32Array){this.values=values;}}
class Node {disconnected=false;connect(){}disconnect(){this.disconnected=true;}}
class Gain extends Node {gain=new Param();}
class BufferFake {duration:number;length:number;sampleRate:number;channels:Float32Array[];constructor(length:number,sampleRate:number){this.length=length;this.sampleRate=sampleRate;this.duration=length/sampleRate;this.channels=[new Float32Array(length),new Float32Array(length)];}getChannelData(ch:number){return this.channels[ch];}}
class Source extends Node {buffer?:BufferFake;playbackRate={value:1};starts:{when:number;offset:number}[]=[];stops=0;start(when:number,offset:number){assert.equal(this.starts.length,0,'AudioBufferSourceNode is one shot');this.starts.push({when,offset});}stop(){this.stops++;}}
class Context {
 static count=0;static latest:Context;state='suspended';currentTime=0;destination={};sources:Source[]=[];media:Node[]=[];gains:Gain[]=[];buffers:BufferFake[]=[];resumes=0;
 constructor(){Context.count++;Context.latest=this;}async resume(){this.resumes++;this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
 createBuffer(_channels:number,n:number,rate:number){const b=new BufferFake(n,rate);this.buffers.push(b);return b;}createBufferSource(){const s=new Source();this.sources.push(s);return s;}createMediaElementSource(){const n=new Node();this.media.push(n);return n;}createGain(){const g=new Gain();this.gains.push(g);return g;}
}
function curveClip():Clip{return {id:'curve',materialId:'v',source:{start:rational(2),duration:rational(3)},target:{start:rational(6),duration:rational(2)},speed:rational(3,2),editableTiming:true,speedCurve:{points:[{x:0,y:1},{x:.5,y:4},{x:1,y:1}]},volume:.6};}
function pcm(){return {sampleRate:44100,sampleCount:88200,channels:[new Float32Array(88200),new Float32Array(88200)] as [Float32Array,Float32Array],bytes:88200*8};}
async function withAudio(run:(audio:PreviewAudio)=>Promise<void>){const original=globalThis.AudioContext;Object.assign(globalThis,{AudioContext:Context});const audio=new PreviewAudio();try{await run(audio);}finally{audio.dispose();Object.assign(globalThis,{AudioContext:original});}}
test('target-clock PCM starts once after user play; normal routes coexist and curved native audio remains muted',async()=>withAudio(async audio=>{
 const clip=curveClip(),data=pcm(),curve={id:clip.id,clip,pcm:data},element={muted:false,volume:.7} as HTMLMediaElement,normalElement={muted:true,volume:.5} as HTMLMediaElement,normal={id:'normal',element:normalElement,clip:{...clip,id:'normal',speedCurve:undefined}},media=[{id:clip.id,element,clip},normal],before=Context.count;
 audio.sync(media,6.5,[curve]);assert.equal(Context.count,before);assert.equal(element.muted,true);assert.equal(audio.curveRoutes.length,0);
 await audio.start();const context=Context.latest;context.currentTime=10;audio.sync(media,6.5,[curve]);
 assert.equal(context.media.length,1);assert.equal(context.sources.length,1);assert.equal(element.muted,true);assert.equal(normalElement.muted,false);assert.equal(context.sources[0].playbackRate.value,1);assert.deepEqual(context.sources[0].starts,[{when:10,offset:.5}]);
 assert.notEqual(.5,toNumber(sourceTimeAt(clip,decimal('6.5'))),'fixture must distinguish target and source clock');
 context.currentTime=10.02;audio.sync(media,6.52,[curve]);assert.equal(context.sources.length,1);assert.equal(context.buffers.length,1);assert(Math.abs(audio.curveRoutes[0].driftMs)<1e-9);assert.equal(audio.curveRoutes[0].startedAt,10);
 context.currentTime=10.03;assert(Math.abs(audio.curveRoutes[0].driftMs-10)<1e-8,'diagnostics expose actual scheduling drift without correcting it');
 audio.sync([normal],6.53,[]);assert.equal(context.sources[0].stops,1);assert(context.sources[0].disconnected);assert.equal(audio.curveRoutes.length,0);audio.sync(media,6.54,[curve]);assert.equal(context.buffers.length,2,'inactive route frees AudioBuffer; parent owns PCM cache');
}));
test('silence, seek, suspend, release and dispose stop one-shot sources; restart uses a fresh source with target offset',async()=>withAudio(async audio=>{
 const clip=curveClip(),curve={id:clip.id,clip,pcm:pcm()};await audio.start();const context=Context.latest;audio.sync([],6.25,[curve]);const first=context.sources[0];audio.silence();assert.equal(first.stops,1);assert(first.disconnected);assert.equal(audio.curveRoutes.length,0);
 audio.sync([],7,[curve]);assert.equal(context.sources.length,2);assert.deepEqual(context.sources[1].starts,[{when:0,offset:1}]);assert.equal(context.buffers.length,1,'seek reuses only currently active buffer');
 await audio.suspend();assert.equal(context.sources[1].stops,1);audio.sync([],7.1,[curve]);assert.equal(context.sources.length,2);assert.equal(context.resumes,1,'sync must never auto-resume');
 await audio.start();audio.sync([],7.1,[curve]);audio.release(clip.id);assert.equal(context.sources[2].stops,1);assert.equal(audio.curveRoutes.length,0);
 audio.sync([],7.2,[curve]);audio.dispose();assert.equal(context.sources[3].stops,1);assert(context.sources.every(s=>s.disconnected));assert(context.gains.every(g=>g.disconnected));assert.equal(audio.state,'closed');await assert.rejects(audio.start(),/PREVIEW_DISPOSED/);
}));
test('curve PCM gain uses original source-clock volume animation and target qsin, without baked or doubled gain',async()=>withAudio(async audio=>{
 const clip=curveClip();clip.volume=.2;clip.animations=[{property:'volume',points:[{id:'a',time:rational(2),value:0,interpolation:'linear'},{id:'b',time:rational(5),value:2,interpolation:'linear'}]}];clip.audioFade={curve:'qsin',inDuration:rational(1),outDuration:rational(1,2)};
 const data=pcm();data.channels[0][100]=.8;const curve={id:clip.id,clip,pcm:data};await audio.start();const context=Context.latest;audio.sync([],6.5,[curve]);const values=context.gains[0].gain.values!;
 assert.equal(context.buffers[0].channels[0][100],data.channels[0][100],'PCM amplitude is copied without baking clip gain');for(const i of [0,31,64,127])assert(Math.abs(values[i]-audioGainAt(clip,6.5+.12*i/127))<1e-6);
 assert(Math.abs(values[0]-.2)>1e-2,'animated source-clock volume must override static gain');audio.sync([],8,[curve]);assert.equal(context.sources[0].stops,1);assert.equal(audio.curveRoutes.length,0);
}));
test('PCM replacement stops old audio and inactive or muted clips cannot start a source',async()=>withAudio(async audio=>{
 const clip=curveClip(),curve={id:clip.id,clip,pcm:pcm()};await audio.start();const context=Context.latest;
 audio.sync([],5,[curve]);assert.equal(context.sources.length,0);audio.sync([],6.1,[curve]);const first=context.sources[0];audio.sync([],6.2,[{...curve,pcm:pcm()}]);assert.equal(first.stops,1);assert(first.disconnected);assert.equal(context.sources.length,2);assert.equal(context.buffers.length,2);
 audio.sync([],6.3,[{...curve,clip:{...clip,muted:true}}]);assert.equal(context.sources[1].stops,1);assert.equal(context.sources.length,2);assert.equal(audio.curveRoutes.length,0);
 audio.sync([],6.4,[]);audio.sync([],6.5,[curve]);assert.equal(context.buffers.length,3);assert.equal(context.sources.length,3);
}));
