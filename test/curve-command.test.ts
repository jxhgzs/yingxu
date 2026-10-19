import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {importJianying} from '../packages/jianying/src/import.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {curveTrimSourceDelta,alignCurveTrimTime} from '../packages/core/src/curve-speed.ts';
import {createSession} from '../packages/core/src/session.ts';
import {rational,micros,add,sub} from '../packages/core/src/time.ts';
import {sourceTimeAt,targetTimeAt} from '../packages/core/src/animation.ts';
const snapshot=(name:string)=>JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-curve/'+name+'.json',import.meta.url),'utf8'));
test('known curve snapshots preserve explicit source/target ranges and native average independently',()=>{
 for(const name of ['01-custom-flat','02-middle-raised','03-split-at-8s10f','04-split-at-8s12f']){const raw=snapshot(name),before=structuredClone(raw),p=importJianying(raw);assert.deepEqual(p.diagnostics,[]);assert.deepEqual(p.provenance.raw,before);assert.deepEqual(raw,before);assert(p.document.tracks.at(-1)!.clips.every(c=>c.speedCurve));}
 const p=importJianying(snapshot('02-middle-raised')).document,c=p.tracks.at(-1)!.clips[0];
 assert.deepEqual(sourceTimeAt(c,micros(8333333)),micros(876935));
 assert.deepEqual(targetTimeAt(c,micros(876935)),micros(8333333));
 assert.deepEqual(sourceTimeAt(c,rational(0)),rational(0));assert.doesNotThrow(()=>sourceTimeAt(c,rational(100)));
});
test('curve non-node split is one exact transaction matching native ranges and new boundary points',()=>{
 const doc=importJianying(snapshot('02-middle-raised')).document,c=doc.tracks.at(-1)!.clips[0],session=createSession(doc);
 const result=session.execute(0,{type:'split',clipId:c.id,at:rational(42,5),rightId:'curve-right'}).document;
 const [left,right]=result.tracks.at(-1)!.clips;
 assert.deepEqual(left.source.duration,micros(1100000));assert.deepEqual(left.target.duration,micros(900000));
 assert.deepEqual(right.source.start,micros(1100000));assert.deepEqual(right.target.start,micros(8400000));
 assert.equal(left.speedCurve!.points.at(-1)!.y,2.8881514072418213);
 assert.deepEqual(session.undo(1).document,doc);assert.deepEqual(session.redo(2).document,result);

});
test('curve setting/reset and switching to constant speed keep source ranges and fail atomically',()=>{
 const doc=importJianying(snapshot('01-custom-flat')).document,c=doc.tracks.at(-1)!.clips[0],peak=importJianying(snapshot('02-middle-raised')).document.tracks.at(-1)!.clips[0].speedCurve!;
 const next=applyCommand(doc,{type:'speed.curve',clipId:c.id,curve:peak,shiftFollowing:false});assert.deepEqual(next.tracks.at(-1)!.clips[0].target.duration,micros(1966666));
 const flat=applyCommand(next,{type:'speed',clipId:c.id,value:rational(2),shiftFollowing:false});assert.equal(flat.tracks.at(-1)!.clips[0].speedCurve,undefined);assert.deepEqual(flat.tracks.at(-1)!.clips[0].target.duration,rational(3,2));
 const reset=applyCommand(next,{type:'speed.curve',clipId:c.id,curve:null,shiftFollowing:false});assert.deepEqual(reset.tracks.at(-1)!.clips[0].source,c.source);assert.deepEqual(reset.tracks.at(-1)!.clips[0].target.duration,rational(3));
 const bad=structuredClone(peak);bad.points[2].y=0;const before=structuredClone(doc);assert.throws(()=>applyCommand(doc,{type:'speed.curve',clipId:c.id,curve:bad,shiftFollowing:true}),/INVALID_CURVE/);assert.deepEqual(doc,before);
 for(const curve of [false,undefined])assert.throws(()=>applyCommand(doc,{type:'speed.curve',clipId:c.id,curve:curve as any,shiftFollowing:false}),/INVALID_CURVE/);
 const raw=snapshot('02-middle-raised'),speed=raw.materials.speeds.find((s:any)=>s.curve_speed);speed.curve_speed.speed_points[2].y=20;const unknown=importJianying(raw);assert(unknown.diagnostics.some(d=>d.code==='CURVE_SPEED_UNSUPPORTED'));assert.equal(unknown.document.tracks.at(-1)!.clips[0].editableTiming,false);
});

// Isolate the video contract; raw text-track draft import remains unsupported.
const trimSnapshot=(name:string)=>{const raw=JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-curve-trim/'+name+'.json',import.meta.url),'utf8'));raw.tracks=raw.tracks.filter((t:any)=>t.type==='video');return raw;};
test('curve direct trim matches all three native snapshots without rebasing curve points',()=>{
 const doc=importJianying(trimSnapshot('00-before-trim')).document,track=doc.tracks.at(-1)!;
 for(const [name,index,edgeDelta,left] of [
   ['01-left-edge-drag',0,micros(200000),true],
   ['02-right-edge-drag',0,micros(-66667),false],
   ['03-second-left-edge-drag',1,micros(200000),true]
 ] as const){
   const c=track.clips[index],delta=curveTrimSourceDelta(c.speedCurve!,edgeDelta),native=importJianying(trimSnapshot(name)).document;
   const command={type:'clip.trim' as const,clipId:c.id,sourceStart:left?add(c.source.start,delta):c.source.start,
     sourceDuration:left?sub(c.source.duration,delta):add(c.source.duration,delta),targetStart:left?add(c.target.start,edgeDelta):c.target.start,pushFollowing:true};
   const session=createSession(doc),result=session.execute(0,command).document;
   for(let i=0;i<track.clips.length;i++){
     const actual=result.tracks.at(-1)!.clips[i],expected=native.tracks.at(-1)!.clips[i];
     assert.deepEqual(actual.source,expected.source,name+' source '+i);assert.deepEqual(actual.target,expected.target,name+' target '+i);
     assert.deepEqual(actual.speedCurve,track.clips[i].speedCurve);
   }
   assert.deepEqual(session.undo(1).document,doc);assert.deepEqual(session.redo(2).document,result);
 }
});
test('curve trim pushes only same-track successors when requested and rejects unknown animation atomically',()=>{
 const doc=importJianying(trimSnapshot('00-before-trim')).document,c=doc.tracks.at(-1)!.clips[0],before=structuredClone(doc);
 const command={type:'clip.trim' as const,clipId:c.id,sourceStart:micros(235762),sourceDuration:micros(864238),targetStart:micros(7700000),pushFollowing:false};
 assert.throws(()=>applyCommand(doc,command),/OVERLAP_POLICY_UNRESOLVED/);assert.deepEqual(doc,before);
 const result=applyCommand(doc,{...command,pushFollowing:true});assert.deepEqual(result.tracks.slice(0,-1),doc.tracks.slice(0,-1));
 const animated=structuredClone(doc);animated.tracks.at(-1)!.clips[0].animations=[{property:'scale',points:[{id:'a',time:rational(0),value:1,interpolation:'linear'}]}];
 assert.throws(()=>applyCommand(animated,{...command,pushFollowing:true}),/CURVE_ANIMATED_TRIM_UNVERIFIED/);assert.deepEqual(doc,before);
 assert.deepEqual(alignCurveTrimTime(micros(333334),rational(30)),micros(333333));
 assert.deepEqual(alignCurveTrimTime(micros(334134),rational(30)),micros(366666));
});
