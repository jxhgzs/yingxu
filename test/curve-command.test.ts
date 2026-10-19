import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {importJianying} from '../packages/jianying/src/import.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {createSession} from '../packages/core/src/session.ts';
import {rational,micros} from '../packages/core/src/time.ts';
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
 assert.throws(()=>applyCommand(doc,{type:'clip.trim',clipId:c.id,sourceStart:rational(0),sourceDuration:rational(2)}),/CURVE_TRIM_UNSUPPORTED/);
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
