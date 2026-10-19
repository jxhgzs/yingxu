import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {applyColorAdjustments,colorAdjustmentStages,normalizeColorAdjustments,validateColorAdjustments} from '../packages/core/src/color-effects.ts';
import {applyTemperatureTint,temperatureTintMatrix} from '../packages/core/src/color-temperature.ts';
import type {ColorAdjustments,RGB} from '../packages/core/src/color-effects.ts';
import {importJianying} from '../packages/jianying/src/import.ts';
import {isKnownColorAdjustment} from '../packages/jianying/src/color-effects.ts';
import {createSession} from '../packages/core/src/session.ts';
import {rational} from '../packages/core/src/time.ts';
import {colorUniforms,colorShader} from '../apps/editor/src/preview/color.ts';
const adjust=(value:Omit<ColorAdjustments,'version'>):ColorAdjustments=>({version:'combine-adjust-v2',...value});
const near=(a:readonly number[],b:readonly number[],tolerance=1e-14)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<=tolerance,`${v} vs ${b[i]}`));
const source=async(name:string)=>JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-temperature/'+name+'.json',import.meta.url),'utf8'));
const files=['02-native-zero','03-temperature-plus50','04-temperature-minus50','05-tint-plus50','06-tint-minus50','07-combination-plus50','08-temperature-plus1','09-reset-zero','10-brightness50-temperature50'];

test('temperature/tint extend the same optional version and preserve neutral and shared matrix ordering',()=>{
 const neutral=normalizeColorAdjustments();assert.equal(neutral.version,'combine-adjust-v2');assert.equal(neutral.temperature,0);assert.equal(neutral.tint,0);
 for(const invalid of [adjust({temperature:NaN}),adjust({tint:Infinity}),adjust({temperature:1.00001}),adjust({tint:-1.00001}),{version:'combine-adjust-v2',tone:0}])assert.throws(()=>validateColorAdjustments(invalid),/INVALID_COLOR_ADJUSTMENTS/);
 const input:RGB=[.25,.5,.75];near(applyColorAdjustments(input,adjust({temperature:1e-5,tint:-1e-5})),input,0);
 near(applyColorAdjustments(input,adjust({temperature:1})),applyTemperatureTint(input,1,0),0);
 near(applyColorAdjustments(input,adjust({tint:-1})),applyTemperatureTint(input,0,-1),0);
 const base=adjust({brightness:.4,contrast:.5,saturation:1,highlight:-.6,shadow:.2}),full=adjust({...base,temperature:1,tint:-1});
 assert.deepEqual(colorAdjustmentStages(full).map(s=>s.kind),['brightness','contrast','saturation','highlight','shadow','temperatureTint']);
 const expected=applyTemperatureTint(applyColorAdjustments(input,base),1,-1);near(applyColorAdjustments(input,full),expected,0);
 const reversed=applyColorAdjustments(applyTemperatureTint(input,1,-1),base);assert.ok(expected.some((v,i)=>Math.abs(v-reversed[i])>.01));
 // A single enabled pair retains the other tiny component. The enable epsilon
 // gates the joint stage, not each component of the physical whitepoint.
 const tiny=1e-6,stage=colorAdjustmentStages(adjust({temperature:tiny,tint:1}))[0];assert.equal(stage.kind,'temperatureTint');if(stage.kind==='temperatureTint')assert.deepEqual(stage.matrix,temperatureTintMatrix(tiny,1));
});

test('nine retained native temperature/tone drafts import without guessed names or version coercion',async()=>{
 for(const file of files){const raw=await source(file),before=structuredClone(raw),imported=importJianying(raw);assert.deepEqual(imported.diagnostics,[],file);const clip=imported.document.tracks[0].clips[0];
  for(const effect of raw.materials.effects){const field=effect.type==='tone'?'tint':effect.type;assert.equal((clip.colorAdjustments as any)?.[field],effect.value);}
  assert.deepEqual(imported.provenance.raw,before);assert.deepEqual(raw,before);assert.deepEqual(clip.target.duration,rational(2));
 }
 for(const mutation of [(raw:any)=>{raw.materials.effects[0].version='v2';},(raw:any)=>{raw.materials.effects[0].type='tint';},(raw:any)=>{raw.materials.effects[0].sub_type='future';},(raw:any)=>{raw.materials.effects[0].future_uniform=1;},(raw:any)=>{const effect={...raw.materials.effects[0],id:'duplicate'};raw.materials.effects.push(effect);raw.tracks[0].segments[0].extra_material_refs.push(effect.id);}]){
  const raw=await source('03-temperature-plus50');mutation(raw);const imported=importJianying(raw);assert.ok(imported.diagnostics.some(d=>d.code==='COLOR_ADJUSTMENTS_NOT_INTERPRETED'));assert.equal(imported.document.tracks[0].clips[0].colorAdjustments,undefined);assert.deepEqual(imported.provenance.raw,raw);
 }
 const observed=(await source('05-tint-plus50')).materials.effects.find((e:any)=>e.type==='tone');assert.equal(observed.sub_type,'manual_zoom');assert.equal(isKnownColorAdjustment(observed),true);
 // The native spelling is allowed only on the two observed parameter types;
 // it is not a general alias for unrelated materials.
 assert.equal(isKnownColorAdjustment({...observed,type:'contrast'}),false);
});

test('temperature commands preserve both controls through split, serialized undo and invalid transactions',async()=>{
 const doc=importJianying(await source('03-temperature-plus50')).document,clip=doc.tracks[0].clips[0],session=createSession(doc);
 const changed=session.execute(0,{type:'clip.update',clipId:clip.id,changes:{colorAdjustments:adjust({temperature:-.5,tint:.7,brightness:.2})}});
 session.execute(1,{type:'split',clipId:clip.id,at:rational(1),rightId:'temperature-right'});assert.deepEqual(session.snapshot().document.tracks[0].clips[1].colorAdjustments,changed.document.tracks[0].clips[0].colorAdjustments);
 const serialized=session.serialize(),restored=createSession(serialized.document,serialized);assert.deepEqual(restored.undo(2).document,changed.document);
 assert.throws(()=>restored.execute(3,{type:'clip.update',clipId:clip.id,changes:{colorAdjustments:adjust({tint:2})}}),/INVALID_COLOR_ADJUSTMENTS/);assert.equal(restored.snapshot().revision,3);
});

test('GPU temperature matrix is column major, joint enabled and applied after the shadow stage',()=>{
 const neutral=colorUniforms();assert.equal(neutral.temperatureEnabled,false);assert.deepEqual([...neutral.temperatureMatrix],[1,0,0,0,1,0,0,0,1]);
 assert.equal(colorUniforms(adjust({temperature:1e-5,tint:-1e-5})).temperatureEnabled,false);
 for(const [temperature,tint] of [[-1,0],[1,0],[0,1],[0,-1],[1,1]] as const){const u=colorUniforms(adjust({temperature,tint})),matrix=temperatureTintMatrix(temperature,tint);assert.equal(u.temperatureEnabled,true);
  for(let row=0;row<3;row++)for(let column=0;column<3;column++)assert.equal(u.temperatureMatrix[column*3+row],Math.fround(matrix[row][column]));
 }
 assert.ok(colorShader.includes('uniform mat3 u_fxTemperatureMatrix'));
 assert.ok(colorShader.indexOf('if(u_fxTemperatureEnabled)')>colorShader.indexOf('if(u_fxEnabled.w)'));
 assert.ok(colorShader.includes('clamp(u_fxTemperatureMatrix*adjusted'));
});
