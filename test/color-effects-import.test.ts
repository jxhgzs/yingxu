import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {importJianying} from '../packages/jianying/src/import.ts';
import {isKnownColorAdjustment} from '../packages/jianying/src/color-effects.ts';
import {createSession} from '../packages/core/src/session.ts';
import {rational} from '../packages/core/src/time.ts';
const files=['02-zero','03-brightness-plus50','04-brightness-minus50','05-saturation-plus50','06-saturation-minus50','07-highlights-plus50','08-highlights-minus50','09-shadows-plus50','10-shadows-minus50'];
const raw=(name:string)=>JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-color-patches/'+name+'.json',import.meta.url),'utf8'));

test('nine real 5.9.0 adjustment drafts preserve versioned values, timing and provenance',()=>{
 for(const file of files){const source=raw(file),before=structuredClone(source),result=importJianying(source);assert.deepEqual(result.diagnostics,[],file);
  const clip=result.document.tracks[0].clips[0];assert.equal(clip.editableTiming,true);assert.deepEqual(clip.colorAdjustments?.version,source.materials.effects.length?'combine-adjust-v2':undefined);
  for(const effect of source.materials.effects){assert(isKnownColorAdjustment(effect));assert.equal(clip.colorAdjustments?.[effect.type as 'brightness'],effect.value);}
  assert.deepEqual(clip.target.duration,rational(2));assert.deepEqual(result.provenance.raw,before);assert.deepEqual(source,before);
 }
});
test('unknown color version, extra parameter and duplicate type remain diagnosed with raw records',()=>{
 for(const mutation of [(s:any)=>{s.materials.effects[0].version='v99';},(s:any)=>{s.materials.effects[0].future_shader=1;},(s:any)=>{const original=s.materials.effects[0],copy={...original,id:'duplicate'};s.materials.effects.push(copy);s.tracks[0].segments[0].extra_material_refs.push(copy.id);}]){
  const source=raw('03-brightness-plus50');mutation(source);const result=importJianying(source);assert(result.diagnostics.some(d=>d.code==='COLOR_ADJUSTMENTS_NOT_INTERPRETED'));assert.equal(result.document.tracks[0].clips[0].colorAdjustments,undefined);assert.deepEqual(result.provenance.raw,source);
 }
});
test('color commands survive split and serialized undo; invalid values do not mutate history',()=>{
 const doc=importJianying(raw('03-brightness-plus50')).document,session=createSession(doc),clip=doc.tracks[0].clips[0];
 const updated=session.execute(0,{type:'clip.update',clipId:clip.id,changes:{colorAdjustments:{version:'combine-adjust-v2',brightness:-.4,saturation:.2,highlight:.3,shadow:-.1}}});
 session.execute(1,{type:'split',clipId:clip.id,at:rational(1),rightId:'right'});assert.deepEqual(session.snapshot().document.tracks[0].clips[1].colorAdjustments,updated.document.tracks[0].clips[0].colorAdjustments);
 const restored=session.serialize(),again=createSession(restored.document,restored);assert.deepEqual(again.undo(2).document,updated.document);
 assert.throws(()=>again.execute(3,{type:'clip.update',clipId:clip.id,changes:{colorAdjustments:{version:'combine-adjust-v2',brightness:1.01}}}),/INVALID_COLOR_ADJUSTMENTS/);assert.equal(again.snapshot().revision,3);
});
