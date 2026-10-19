import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Document,Clip} from '../packages/core/src/document.ts';
import {validateDocument} from '../packages/core/src/document.ts';
import {rational as r} from '../packages/core/src/time.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {transitionBoundaryPolicy} from '../packages/core/src/transitions.ts';
import {buildTransitionCandidate,transitionDurationFromInput} from '../apps/editor/src/transition-candidate.ts';

function fixture():Document{
 const clip=(id:string,target:number,source:number):Clip=>({id,materialId:'asset',source:{start:r(source),duration:r(2)},target:{start:r(target),duration:r(2)},speed:r(1),editableTiming:true});
 return {schemaVersion:1,canvas:{width:1280,height:720},fps:r(30),assets:[{id:'asset',path:'/test/source.mp4',name:'自有测试源',kind:'video',duration:r(6),fps:r(30),frameTiming:'cfr30'}],tracks:[{id:'track',kind:'video',clips:[clip('a',0,4),clip('b',2,0)]}]};
}

test('UI shared candidate admits confirmed CFR30 zero handles using an exact even-frame window',()=>{
 const doc=fixture(),before=structuredClone(doc),value=buildTransitionCandidate(doc,'track','a','crossfade');
 assert.ok(value.transition,value.reason);assert.deepEqual(value.transition.duration,r(14,30));assert.equal(value.name,'自有测试源');
 const [a,b]=doc.tracks[0].clips;
 assert.equal(transitionBoundaryPolicy(doc.fps,value.transition,a,b,doc.assets[0],doc.assets[0]),'clone-cfr30');
 const next=applyCommand(doc,{type:'transition.add',transition:value.transition});validateDocument(next);assert.equal(next.transitions?.length,1);
 assert.deepEqual(doc,before,'candidate and command must preserve input/source/target');
});

test('UI shared candidate preserves half-second default with full handles and falls back to exact available handles',()=>{
 const doc=fixture();delete doc.assets[0].frameTiming;doc.tracks[0].clips[0].source.start=r(0);doc.tracks[0].clips[1].source.start=r(3);
 assert.deepEqual(buildTransitionCandidate(doc,'track','a','crossfade').transition?.duration,r(1,2));
 doc.tracks[0].clips[1].source.start=r(1,10);
 assert.deepEqual(buildTransitionCandidate(doc,'track','a','crossfade').transition?.duration,r(1,5));
});

test('UI shared candidate keeps unconfirmed zero-handle media and unverified timing closed',()=>{
 const cases:[string,(d:Document)=>void][]=[
  ['unknown frame timing',d=>{delete d.assets[0].frameTiming;}],
  ['other document fps',d=>{d.fps=r(24);}],
  ['2x',d=>{const a=d.tracks[0].clips[0];a.source={start:r(2),duration:r(4)};a.speed=r(2);}],
  ['non-frame cut',d=>{const [a,b]=d.tracks[0].clips;a.source={start:r(239,60),duration:r(121,60)};a.target.duration=r(121,60);b.target.start=r(121,60);}]
 ];
 for(const [label,mutate] of cases){const doc=fixture();mutate(doc);const before=structuredClone(doc),value=buildTransitionCandidate(doc,'track','a','crossfade');assert.equal(value.transition,undefined,label);assert.ok(value.reason,label);assert.deepEqual(doc,before,label);}
});

test('UI shared candidate requires adjacency, avoids duplicate cuts and uses an unused temporary identity',()=>{
 const doc=fixture();assert.equal(buildTransitionCandidate(undefined,undefined,undefined,'crossfade').transition,undefined);
 assert.equal(buildTransitionCandidate(doc,'track','b','crossfade').transition,undefined);
 doc.tracks[0].clips[1].target.start=r(3);assert.equal(buildTransitionCandidate(doc,'track','a','crossfade').transition,undefined);
 const restored=fixture(),source=restored.tracks[0].clips[1];
 restored.tracks[0].clips.push({...structuredClone(source),id:'c',target:{start:r(4),duration:r(2)},source:{start:r(2),duration:r(2)}},{...structuredClone(source),id:'d',target:{start:r(6),duration:r(2)},source:{start:r(4),duration:r(2)}});
 restored.transitions=[{id:'transition-candidate',trackId:'track',outgoingClipId:'c',incomingClipId:'d',kind:'crossfade',alignment:'center',overlap:true,duration:r(1,2)}];
 const value=buildTransitionCandidate(restored,'track','a','crossfade');assert.ok(value.transition,value.reason);assert.notEqual(value.transition.id,'transition-candidate');
 restored.transitions.push(value.transition);assert.equal(buildTransitionCandidate(restored,'track','a','crossfade').transition,undefined);
});

test('UI shared candidate leaves non-overlap dip-to-black available without source handles',()=>{
 const doc=fixture();delete doc.assets[0].frameTiming;assert.deepEqual(buildTransitionCandidate(doc,'track','a','dipToBlack').transition?.duration,r(1,2));
});

test('unchanged inspector rounding preserves the original rational frame duration',()=>{
 const value=buildTransitionCandidate(fixture(),'track','a','crossfade').transition!;
 assert.deepEqual(transitionDurationFromInput(value,14/30),r(14,30));
 assert.deepEqual(transitionDurationFromInput(value,0.466667),r(14,30));
 assert.deepEqual(transitionDurationFromInput(value,0.4),r(2,5));
 assert.deepEqual(transitionDurationFromInput(value,0.466666),r(233333,500000));
 const next=applyCommand({...fixture(),transitions:[value]},{type:'transition.update',transitionId:value.id,changes:{duration:transitionDurationFromInput(value,0.466667)}});validateDocument(next);
});
