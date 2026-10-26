import test from 'node:test';import assert from 'node:assert/strict';
import {emptyDocument,validateDocument} from '../packages/core/src/document.ts';
import {rational as r,compare} from '../packages/core/src/time.ts';import {applyCommand} from '../packages/core/src/commands.ts';
import {quickCutCommand,freezeCommand,reverseReplacement} from '../packages/core/src/timeline-tools.ts';
import {cropPixels} from '../packages/core/src/crop.ts';
function fixture(){const d=emptyDocument();d.canvas={width:1280,height:720};d.assets=[{id:'a',path:'/fixture',kind:'video',width:1280,height:720,duration:r(9)}];d.tracks[0].clips=[{id:'c',materialId:'a',source:{start:r(0),duration:r(3)},target:{start:r(0),duration:r(3)},speed:r(1),editableTiming:true},{id:'b',materialId:'a',source:{start:r(3),duration:r(3)},target:{start:r(3),duration:r(3)},speed:r(1),editableTiming:true}];return d;}
test('native ordinary quick cuts preserve ID and move only following clips on the magnetic main track',()=>{
 const d=fixture();const left=applyCommand(d,quickCutCommand(d,'c',r(1),'left'));
 assert.deepEqual(left.tracks[0].clips[0].source,{start:r(1),duration:r(2)});assert.deepEqual(left.tracks[0].clips[0].target,{start:r(0),duration:r(2)});assert.equal(left.tracks[0].clips[0].id,'c');assert.deepEqual(left.tracks[0].clips[1].target.start,r(2));
 const right=applyCommand(d,quickCutCommand(d,'c',r(1),'right'));assert.deepEqual(right.tracks[0].clips[0].source,{start:r(0),duration:r(1)});assert.deepEqual(right.tracks[0].clips[1].target.start,r(1));
 d.mainTrackMagnet=false;const gap=applyCommand(d,quickCutCommand(d,'c',r(1),'left'));assert.deepEqual(gap.tracks[0].clips[0].target.start,r(1));assert.deepEqual(gap.tracks[0].clips[1].target.start,r(3));assert.deepEqual(d.tracks[0].clips[0].source.start,r(0));
 assert.throws(()=>quickCutCommand(d,'c',r(0),'left'),/SPLIT_OUTSIDE/);d.tracks[0].locked=true;assert.throws(()=>quickCutCommand(d,'c',r(1),'right'),/TRACK_LOCKED/);
});
test('global and clip markers persist, update, delete and split in source time',()=>{
 let d=fixture();d=applyCommand(d,{type:'marker.set',clipId:'c',marker:{id:'m',time:r(2),title:'镜头',color:'#00c1cd'}});d=applyCommand(d,{type:'marker.set',marker:{id:'g',time:r(4),title:'全局',color:'#ffcc00'}});
 const split=applyCommand(d,{type:'split',clipId:'c',at:r(1),rightId:'right'});assert.equal(split.tracks[0].clips[0].markers?.length,0);assert.equal(split.tracks[0].clips[1].markers?.[0].id,'m');
 d=applyCommand(d,{type:'marker.remove',clipId:'c',markerId:'m'});assert.equal(d.tracks[0].clips[0].markers?.length,0);assert.equal(d.markers?.[0].title,'全局');assert.throws(()=>applyCommand(d,{type:'marker.set',marker:{id:'bad',time:r(-1),title:'bad',color:'#ffffff'}}),/INVALID_MARKER/);
});
test('freeze inserts a still at the split, preserving both source halves and one transaction of timing',()=>{
 const d=fixture(),image={id:'still',path:'/still.png',kind:'image' as const,duration:r(3600),width:1280,height:720};
 const next=applyCommand(d,freezeCommand(d,'c',r(1),image,'freeze','right'));
 const clips=[...next.tracks[0].clips].sort((a,b)=>compare(a.target.start,b.target.start));assert.deepEqual(clips.map(c=>[c.id,c.target.start,c.target.duration]),[['c',r(0),r(1)],['freeze',r(1),r(3)],['right',r(4),r(2)],['b',r(6),r(3)]]);assert.deepEqual(clips[2].source,{start:r(1),duration:r(2)});assert.equal(next.assets.length,2);assert.equal(d.assets.length,1);
});
test('reverse replacement preserves effects/target time and rebases source keyframes',()=>{
 const d=fixture(),c=d.tracks[0].clips[0];c.source.start=r(2);c.markers=[{id:'m',time:r(3),title:'M',color:'#ffffff'}];c.animations=[{property:'x',points:[{id:'p',time:r(2),value:4,interpolation:'linear'},{id:'q',time:r(5),value:10,interpolation:'linear'}]}];
 const replacement=reverseReplacement(c,{...d.assets[0],id:'rev',duration:r(3)});assert.deepEqual(replacement.source,{start:r(0),duration:r(3)});assert.deepEqual(replacement.target,c.target);assert.deepEqual(replacement.animations![0].points.map(p=>p.time),[r(0),r(3)]);assert.deepEqual(replacement.markers![0].time,r(2));
});
test('crop uses a shared integer source window and rejects invalid rectangles and text crops',()=>{
 assert.deepEqual(cropPixels({width:1280,height:720},{x:.25,y:0,width:.5,height:1}),{x:320,y:0,width:640,height:720});
 const d=fixture();d.tracks[0].clips[0].crop={x:.9,y:0,width:.2,height:1};assert.throws(()=>validateDocument(d),/INVALID_CROP/);
});
