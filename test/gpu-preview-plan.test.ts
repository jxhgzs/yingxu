import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import type {Clip} from '../packages/core/src/document.ts';
import {rational,div} from '../packages/core/src/time.ts';
import {createPreviewPlan,previewFrame,layerVertices} from '../apps/editor/src/preview/plan.ts';
import {audioGainAt} from '../apps/editor/src/preview/audio.ts';

function document(){const d=emptyDocument();d.canvas={width:320,height:180};d.assets.push({id:'v',kind:'video',path:'/must-not-use.mp4',duration:rational(10),width:320,height:180,hasAudio:true,fps:rational(30)});return d;}
function clip():Clip{return {id:'c',materialId:'v',source:{start:rational(3),duration:rational(3)},target:{start:rational(6),duration:rational(3,2)},speed:rational(2),editableTiming:true,transform:defaultTransform()};}

test('GPU plan keeps moved 2x source-clock events and refuses unresolved effects',()=>{
 const d=document(),c=clip();c.animations=[{property:'scale',points:[{id:'k0',time:rational(3),value:1,interpolation:'linear'},{id:'k1',time:rational(5),value:1.25,interpolation:'linear'}]}];d.tracks[0].clips.push(c);
 const result=createPreviewPlan(d);assert.equal(result.support.supported,true);assert(result.plan);
 const f=previewFrame(result.plan!,rational(7));assert.equal(f.layers.length,1);assert.deepEqual(f.layers[0].sourceTime,rational(5));assert.equal(f.layers[0].transform.scale,1.25);
 assert.equal(f.audio.length,1);assert.equal(previewFrame(result.plan!,rational(15,2)).layers.length,0);
 assert.equal(createPreviewPlan(d,{diagnostics:[{code:'UNKNOWN_EFFECT'}]}).support.supported,false);
 assert.equal(d.tracks[0].clips[0].transform!.scale,1,'planning changed source document');
});
test('GPU visibility preserves half-open one-frame boundaries including NTSC',()=>{
 for(const fps of [rational(30),rational(60),rational(30000,1001)]){
 const d=document();d.fps=fps;const period=div(rational(1),fps),c=clip();c.source={start:rational(0),duration:period};c.target={start:period,duration:period};c.speed=rational(1);d.tracks[0].clips.push(c);
 const p=createPreviewPlan(d).plan!;
 assert.equal(previewFrame(p,rational(0)).layers.length,0);assert.equal(previewFrame(p,period).layers.length,1);
 assert.equal(previewFrame(p,div(rational(2),fps)).layers.length,0);
 }
});
test('letterbox, clockwise rotation and UV flips preserve the documented screen geometry',()=>{
 const canvas={width:320,height:180},asset={width:100,height:200};
 const points=layerVertices(asset,defaultTransform(),canvas);
 assert(Math.abs(points[0]-(-.28125))<1e-7);assert.equal(points[1],1);assert.equal(points[2],0);assert.equal(points[3],0);
 const flipped=layerVertices(asset,{...defaultTransform(),flipX:true},canvas);assert.equal(flipped[0],points[0]);assert.equal(flipped[2],1);
 const rotated=layerVertices(asset,{...defaultTransform(),rotation:90,x:16,y:9},canvas);
 // Portrait top-left (-45,-90) rotates clockwise to (+90,-45), then translates.
 assert(Math.abs(rotated[0]-(2*(160+90+16)/320-1))<1e-6);
 assert(Math.abs(rotated[1]-(1-2*(90-45+9)/180))<1e-6);
});
test('hidden text is ignored, visible text/curves fall back and muted audio does not leak',()=>{
 const d=document();d.tracks[0].clips.push(clip());d.assets.push({id:'text',kind:'text',path:'',duration:rational(3600)});
 d.tracks[2].clips.push({...clip(),id:'t',materialId:'text',text:{content:'文字',size:30,font:'Arial',color:'#ffffff'}});d.tracks[2].hidden=true;d.tracks[0].muted=true;
 const known=createPreviewPlan(d);assert.equal(known.support.supported,true);assert.equal(previewFrame(known.plan!,rational(7)).audio.length,0);
 d.tracks[2].hidden=false;assert(createPreviewPlan(d).support.reasons.some(r=>r.code==='TEXT_REQUIRES_OFFLINE_RENDER'));
 d.tracks[2].hidden=true;d.tracks[0].clips[0].speedCurve={points:[{x:0,y:1},{x:1,y:1}]};
 assert(createPreviewPlan(d).support.reasons.some(r=>r.code==='CURVE_SPEED_REQUIRES_OFFLINE_RENDER'));
});
test('qsin gains use target-time fades and source-time volume at 2x',()=>{
 const c=clip();c.source={start:rational(0),duration:rational(4)};c.target={start:rational(1),duration:rational(2)};
 c.animations=[{property:'volume',points:[{id:'a',time:rational(0),value:0,interpolation:'linear'},{id:'b',time:rational(4),value:2,interpolation:'linear'}]}];
 c.audioFade={curve:'qsin',inDuration:rational(1),outDuration:rational(1,2)};
 assert.equal(audioGainAt(c,1),0);assert(Math.abs(audioGainAt(c,1.5)-.5*Math.SQRT1_2)<1e-12);
 assert(Math.abs(audioGainAt(c,2.75)-1.75*Math.SQRT1_2)<1e-12);assert.equal(audioGainAt(c,3),0);
});
