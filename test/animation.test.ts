import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument, validateDocument} from '../packages/core/src/document.ts';
import {rational, add} from '../packages/core/src/time.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {evaluateAnimation, sourceTimeAt,keyframeAtFrame} from '../packages/core/src/animation.ts';
import type {Animation} from '../packages/core/src/animation.ts';
import {createSession} from '../packages/core/src/session.ts';

function example(){
  const d=emptyDocument();d.assets.push({id:'a',path:'/fixture',duration:rational(10)});
  d.tracks[0].clips.push({id:'c',materialId:'a',source:{start:rational(3),duration:rational(3)},target:{start:rational(6),duration:rational(3,2)},speed:rational(2),editableTiming:true,
    animations:[{property:'scale',points:[{id:'p1',time:rational(3),value:1,interpolation:'linear'},{id:'p2',time:rational(5),value:1.25,interpolation:'linear'}]}]});
  return d;
}
test('source clock reproduces observed moved, 2x and split keyframe values',()=>{
  const d=example(),c=d.tracks[0].clips[0],a=c.animations![0];
  assert.equal(evaluateAnimation(a,sourceTimeAt(c,rational(13,2))),1.125);
  assert.equal(evaluateAnimation(a,sourceTimeAt(c,rational(7))),1.25);
  assert.equal(evaluateAnimation(a,rational(0)),1);assert.equal(evaluateAnimation(a,rational(8)),1.25);
  const split=applyCommand(d,{type:'split',clipId:'c',rightId:'r',at:rational(13,2)});
  assert.deepEqual(split.tracks[0].clips.map(c=>c.animations![0].points.map(p=>[p.time,p.value])),[
    [[rational(3),1],[rational(4),1.125]],[[rational(4),1.125],[rational(5),1.25]]]);
  const moved=applyCommand(d,{type:'clip.move',clipId:'c',trackId:'video-main',start:rational(8)});
  assert.deepEqual(moved.tracks[0].clips[0].animations,c.animations);
  assert.equal(evaluateAnimation(a,sourceTimeAt(moved.tracks[0].clips[0],rational(17,2))),1.125);
  const slow=applyCommand(d,{type:'speed',clipId:'c',value:rational(1,2),shiftFollowing:false});
  assert.deepEqual(slow.tracks[0].clips[0].animations,c.animations);
  assert.equal(evaluateAnimation(a,sourceTimeAt(slow.tracks[0].clips[0],rational(8))),1.125);
});
test('keyframe edits replace exact times, reject invalid values atomically and restore last value',()=>{
  let d=example();const before=structuredClone(d);
  assert.throws(()=>applyCommand(d,{type:'keyframe.set',clipId:'c',property:'opacity',point:{id:'bad',time:rational(4),value:2,interpolation:'linear'}}),/INVALID_KEYFRAME/);
  assert.deepEqual(d,before);
  d=applyCommand(d,{type:'keyframe.set',clipId:'c',property:'scale',point:{id:'new',time:rational(3),value:1.1,interpolation:'linear'}});
  assert.equal(d.tracks[0].clips[0].animations![0].points.length,2);
  d=applyCommand(d,{type:'keyframe.remove',clipId:'c',property:'scale',pointId:'p2'});
  d=applyCommand(d,{type:'keyframe.remove',clipId:'c',property:'scale',pointId:'new'});
  assert.deepEqual(d.tracks[0].clips[0].animations,[]);assert.equal(d.tracks[0].clips[0].transform!.scale,1.1);
  const locked=applyCommand(example(),{type:'track.update',trackId:'video-main',changes:{locked:true}});
  assert.throws(()=>applyCommand(locked,{type:'keyframe.remove',clipId:'c',property:'scale',pointId:'p2'}),/TRACK_LOCKED/);
});
test('hold interpolation, trimming boundary and invalid animation structure',()=>{
  const a:Animation={property:'x',points:[{id:'a',time:rational(1),value:0,interpolation:'hold'},{id:'b',time:rational(2),value:100,interpolation:'linear'}]};
  assert.equal(evaluateAnimation(a,rational(1999,1000)),0);assert.equal(evaluateAnimation(a,rational(2)),100);
  const d=example(),trimmed=applyCommand(d,{type:'clip.trim',clipId:'c',sourceStart:rational(4),sourceDuration:rational(1)});
  assert.equal(trimmed.tracks[0].clips[0].animations![0].points[0].value,1.125);
  for(const mutate of [
    (a:Animation[])=>a.push(structuredClone(a[0])),
    (a:Animation[])=>a[0].points.push({...a[0].points[0],id:'dup'}),
    (a:Animation[])=>a[0].points[0].value=NaN,
    (a:Animation[])=>a[0].points[1].time=add(d.assets[0].duration,rational(1)),
  ]){const invalid=structuredClone(d);mutate(invalid.tracks[0].clips[0].animations!);assert.throws(()=>validateDocument(invalid));}
});
test('a grouped property gesture has one revision and rolls back completely on a failed child',()=>{
  const d=example(),s=createSession(d);
  const done=s.execute(0,{type:'batch',commands:[
    {type:'keyframe.set',clipId:'c',property:'scale',point:{id:'p',time:rational(4),value:1.4,interpolation:'linear'}},
    {type:'clip.update',clipId:'c',changes:{volume:.5}},
  ]});assert.equal(done.revision,1);assert.equal(done.document.tracks[0].clips[0].volume,.5);
  assert.deepEqual(s.undo(1).document,d);assert.deepEqual(s.redo(2).document,done.document);
  assert.throws(()=>s.execute(3,{type:'batch',commands:[{type:'clip.remove',clipId:'c',ripple:false},{type:'clip.update',clipId:'missing',changes:{volume:1}}]}),/CLIP_NOT_FOUND/);
  assert.deepEqual(s.snapshot().document,done.document);assert.equal(s.snapshot().revision,3);
});
test('UI frame hit testing preserves an existing half-frame keyframe after speed changes',()=>{
  const d=example(),c=d.tracks[0].clips[0];c.target.start=rational(3,4);
  // Source 5 maps to target 1.75, between output frame 52 and 53 at 30 fps.
  const point=keyframeAtFrame(c,'scale',rational(53,30),rational(30));
  assert.equal(point?.id,'p2');assert.deepEqual(point?.time,rational(5));
  assert.equal(keyframeAtFrame(c,'scale',rational(54,30),rational(30)),undefined);
});
