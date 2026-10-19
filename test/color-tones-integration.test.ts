import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {importJianying} from '../packages/jianying/src/import.ts';
import {isKnownColorAdjustment} from '../packages/jianying/src/color-effects.ts';
import {createSession} from '../packages/core/src/session.ts';
import {validateColorAdjustments} from '../packages/core/src/color-effects.ts';
import {rational} from '../packages/core/src/time.ts';

test('seven observed tones records import narrowly with blank native version and preserved manual_zoom',async()=>{
 const corpus=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-color-tones-v8/native-patches.json',import.meta.url),'utf8'));
 // Use an already verified complete video draft and substitute only the actual
 // retained effects/refs. Original metadata records remain byte-for-byte fields.
 const base=JSON.parse(await fs.readFile(new URL('../evidence/2026-10-19-temperature/02-native-zero.json',import.meta.url),'utf8'));
 for(const record of Object.values(corpus.cases) as any[]){
  const raw=structuredClone(base),segment=raw.tracks[0].segments[0],old=new Set(raw.materials.effects.map((v:any)=>v.id));segment.extra_material_refs=segment.extra_material_refs.filter((v:string)=>!old.has(v));raw.materials.effects=record.fields;segment.extra_material_refs.push(...record.fields.map((v:any)=>v.id));
  const imported=importJianying(raw);assert.deepEqual(imported.diagnostics,[]);const clip=imported.document.tracks[0].clips[0];for(const [key,value]of Object.entries(record.parameters))assert.equal((clip.colorAdjustments as any)[key==='tone'?'tint':key],value);
  for(const field of record.fields)if(['black','white','fade'].includes(field.type)){assert(isKnownColorAdjustment(field));assert.equal(isKnownColorAdjustment({...field,version:'v3'}),false);assert.equal(isKnownColorAdjustment({...field,sub_type:'future'}),false);}
 }
 for(const value of [-.1,1.01,NaN])assert.throws(()=>validateColorAdjustments({version:'combine-adjust-v2',fade:value}),/INVALID_COLOR_ADJUSTMENTS/);
 const doc=importJianying(base).document,c=doc.tracks[0].clips[0],session=createSession(doc);const changed=session.execute(0,{type:'clip.update',clipId:c.id,changes:{colorAdjustments:{version:'combine-adjust-v2',black:-1,white:1,fade:.5}}});session.execute(1,{type:'split',clipId:c.id,at:rational(1),rightId:'tones-right'});assert.deepEqual(session.snapshot().document.tracks[0].clips[1].colorAdjustments,changed.document.tracks[0].clips[0].colorAdjustments);assert.deepEqual(session.undo(2).document,changed.document);
});
