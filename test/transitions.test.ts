import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateDocument} from '../packages/core/src/document.ts';
import type {Clip,Document,Transition} from '../packages/core/src/document.ts';
import {rational as r,micros} from '../packages/core/src/time.ts';
import {transitionWindow,transitionSourceAt,transitionHandles} from '../packages/core/src/transitions.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import type {AtomicCommand} from '../packages/core/src/commands.ts';
import {createSession} from '../packages/core/src/session.ts';

function fixture():Document {
  const clip=(id:string,start:number,source:number,speed=1):Clip=>({id,materialId:'v',source:{start:r(source),duration:r(4*speed)},target:{start:r(start),duration:r(4)},speed:r(speed),editableTiming:true});
  return {schemaVersion:1,canvas:{width:1280,height:720},fps:r(30),assets:[{id:'v',path:'/test/video.mov',kind:'video',duration:r(30)}],tracks:[{id:'vtrack',kind:'video',clips:[clip('a',0,2,2),clip('b',4,5),clip('c',8,10)]}]};
}
function transition(duration=r(1)):Transition{return {id:'ab',trackId:'vtrack',outgoingClipId:'a',incomingClipId:'b',kind:'crossfade',alignment:'center',overlap:true,duration};}
function withTransition():Document {const doc=fixture();doc.transitions=[transition()];return doc;}

test('centered transition extends both source handles using each constant speed, without clamping',()=>{
  const doc=fixture(),[a,b]=doc.tracks[0].clips,t=transition(micros(333333));
  assert.deepEqual(transitionWindow(t,a),{start:r(7666667,2000000),duration:micros(333333)});
  assert.deepEqual(transitionSourceAt(a,r(9,2)),r(11));
  assert.deepEqual(transitionSourceAt(b,r(7,2)),r(9,2));
  assert.deepEqual(transitionHandles(t,a,b),{window:transitionWindow(t,a),outgoingSourceEnd:r(10333333,1000000),incomingSourceStart:r(9666667,2000000)});
  doc.transitions=[t];assert.doesNotThrow(()=>validateDocument(doc));
});

test('document validation rejects unsafe or unverified transitions independently of commands',()=>{
  const cases:[string,(doc:Document)=>void][]=[
    ['SOURCE_HANDLES_MISSING',d=>{d.tracks[0].clips[1].source.start=r(0);}],
    ['SOURCE_HANDLES_MISSING',d=>{d.assets[0].duration=r(10);d.tracks[0].clips[2].source={start:r(6),duration:r(4)};}],
    ['PAIR_NOT_ADJACENT',d=>{d.tracks[0].clips[1].target.start=micros(4000001);}],
    ['PAIR_NOT_ADJACENT',d=>{d.transitions![0].incomingClipId='c';}],
    ['INVALID_TRANSITION_DURATION',d=>{d.transitions![0].duration=r(2000001,1000000);}],
    ['INVALID_TRANSITION_DURATION',d=>{d.transitions![0].duration=r(0);}],
    ['DURATION_BELOW_ONE_FRAME',d=>{d.transitions![0].duration=micros(1);}],
    ['KIND_UNVERIFIED',d=>{(d.transitions![0] as any).kind='unknown';}],
    ['UNSUPPORTED_TRANSITION_FIELD',d=>{(d.transitions![0] as any).easing='bezier';}],
    ['ALIGNMENT_UNSUPPORTED',d=>{(d.transitions![0] as any).overlap=false;}],
    ['TIME_MAPPING_UNSUPPORTED',d=>{d.tracks[0].clips[1].speedCurve={points:[{x:0,y:1},{x:1,y:1}]};}],
    ['MEDIA_UNSUPPORTED',d=>{d.assets[0].kind='image';}],
    ['DUPLICATE_TRANSITION_PAIR',d=>{d.transitions!.push({...transition(),id:'other'});}],
    ['DUPLICATE_TRANSITION_ID',d=>{d.transitions!.push({...transition(),outgoingClipId:'b',incomingClipId:'c'});}],
  ];
  for(const [code,mutate] of cases){const doc=withTransition();mutate(doc);assert.throws(()=>validateDocument(doc),new RegExp(code),code);}
});

test('pair order uses target time, exact handles and half durations are inclusive',()=>{
  const doc=withTransition();doc.transitions![0].duration=r(2);doc.tracks[0].clips[1].source.start=r(1);doc.assets[0].duration=r(12);doc.tracks[0].clips[2].source={start:r(8),duration:r(4)};
  doc.tracks[0].clips.reverse();assert.doesNotThrow(()=>validateDocument(doc));
});

test('add update remove are atomic, undo redo restore exact transition records',()=>{
  const doc=fixture(),session=createSession(doc);
  session.execute(0,{type:'transition.add',transition:transition()});
  const added=session.snapshot();assert.deepEqual(added.document.transitions,[transition()]);assert.equal(doc.transitions,undefined);
  assert.throws(()=>session.execute(1,{type:'transition.update',transitionId:'ab',changes:{duration:r(3)}}),/INVALID_TRANSITION_DURATION/);
  assert.deepEqual(session.snapshot(),added);
  session.execute(1,{type:'transition.update',transitionId:'ab',changes:{duration:r(1,2)}});
  assert.deepEqual(session.undo(2).document,added.document);
  assert.deepEqual(session.redo(3).document.transitions![0].duration,r(1,2));
  assert.deepEqual(session.execute(4,{type:'transition.remove',transitionId:'ab'}).document.transitions,[]);
  assert.deepEqual(session.undo(5).document.transitions![0].duration,r(1,2));
});

test('timing edits require removal first; one batch removes and edits with one undo',()=>{
  const doc=withTransition();
  const commands:AtomicCommand[]=[
    {type:'clip.remove',clipId:'a',ripple:false},
    {type:'clip.move',clipId:'b',trackId:'vtrack',start:r(20)},
    {type:'clip.trim',clipId:'a',sourceStart:r(2),sourceDuration:r(6)},
    {type:'split',clipId:'a',at:r(1),rightId:'split'},
    {type:'speed',clipId:'a',value:r(1),shiftFollowing:true},
    {type:'speed.curve',clipId:'b',curve:null,shiftFollowing:true},
  ];
  for(const command of commands)assert.throws(()=>applyCommand(doc,command),/TRANSITION_EDIT_REQUIRES_REMOVAL/);
  assert.equal(applyCommand(doc,{type:'clip.update',clipId:'b',changes:{volume:.5}}).tracks[0].clips[1].volume,.5);
  const session=createSession(doc);session.execute(0,{type:'batch',commands:[{type:'transition.remove',transitionId:'ab'},{type:'split',clipId:'a',at:r(1),rightId:'split'}]});
  assert.equal(session.snapshot().document.tracks[0].clips.length,4);assert.deepEqual(session.undo(1).document,doc);
});

test('locked tracks reject transition changes and asset relink rechecks source handles',()=>{
  const doc=withTransition();doc.tracks[0].locked=true;
  for(const command of [{type:'transition.add',transition:{...transition(),id:'new'}},{type:'transition.update',transitionId:'ab',changes:{duration:r(1,2)}},{type:'transition.remove',transitionId:'ab'}] as AtomicCommand[])assert.throws(()=>applyCommand(doc,command),/TRACK_LOCKED/);
  const relink=withTransition();relink.tracks[0].clips.pop();
  assert.throws(()=>applyCommand(relink,{type:'asset.relink',assetId:'v',replacement:{id:'new',path:'/short.mov',kind:'video',duration:r(10)}}),/TRANSITION_SOURCE_HANDLES_MISSING/);
});
