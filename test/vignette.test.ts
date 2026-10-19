import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {applyVignette,validateVignette,vignetteParameters} from '../packages/core/src/vignette.ts';
import {importJianying} from '../packages/jianying/src/import.ts';import {createSession} from '../packages/core/src/session.ts';import {rational} from '../packages/core/src/time.ts';
const raw=()=>JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-vignette-v9/01-vignette-positive-ui.json',import.meta.url),'utf8'));
test('spatial v1 validates finite normalized parameters and neutral values preserve RGB exactly',()=>{
 for(const value of [null,[],{}, {version:'v2',intensity:1},{version:'v1',intensity:NaN},{version:'v1',intensity:1.0001},{version:'v1',intensity:'1'},{version:'v1',intensity:1,other:0}])assert.throws(()=>validateVignette(value),/INVALID_VIGNETTE/);
 const rgb=[.2,.4,.8] as const;assert.deepEqual(applyVignette(rgb,0,0),rgb);assert.deepEqual(applyVignette(rgb,0,0,{version:'v1',intensity:0}),rgb);
 for(const value of [-1,-.5,.5,1]){const v={version:'v1' as const,intensity:value},center=applyVignette(rgb,.5,.5,v),corner=applyVignette(rgb,0,0,v);assert.deepEqual(center,rgb);assert.deepEqual(corner,applyVignette(rgb,1,1,v));assert(corner.every((n,i)=>value>0?n<=rgb[i]:n>=rgb[i]));assert(vignetteParameters(value).outer>vignetteParameters(value).inner);}
 assert.throws(()=>applyVignette([1,2,3],.5,.5,{version:'v1',intensity:1}),/INVALID_COLOR_RGB/);
 assert.throws(()=>applyVignette(rgb,NaN,0,{version:'v1',intensity:1}),/INVALID_VIGNETTE_UV/);
});
test('real v1 draft imports losslessly, unknown resource/duplicate values retain raw diagnostics',()=>{
 const source=raw(),before=structuredClone(source),result=importJianying(source),clip=result.document.tracks.flatMap(t=>t.clips)[0];assert.deepEqual(result.diagnostics,[]);assert.deepEqual(clip.vignette,{version:'v1',intensity:1});assert.deepEqual(source,before);assert.deepEqual(result.provenance.raw,before);
 for(const mutate of [(e:any)=>e.version='v9',(e:any)=>e.path+='_unknown',(e:any)=>e.sub_type='manual_zoom',(e:any)=>e.value=2]){const x=raw();mutate(x.materials.effects.find((e:any)=>e.type==='vignetting'));const r=importJianying(x);assert(r.diagnostics.some(d=>d.code==='COLOR_ADJUSTMENTS_NOT_INTERPRETED'));assert.equal(r.document.tracks.flatMap(t=>t.clips)[0].vignette,undefined);assert.deepEqual(r.provenance.raw,x);}
 const duplicate=raw(),e=structuredClone(duplicate.materials.effects.find((e:any)=>e.type==='vignetting'));e.id='vignette-duplicate';duplicate.materials.effects.push(e);duplicate.tracks.flatMap((t:any)=>t.segments)[0].extra_material_refs.push(e.id);assert(importJianying(duplicate).diagnostics.some(d=>d.code==='COLOR_ADJUSTMENTS_NOT_INTERPRETED'));
});
test('vignette clip edits preserve split, serialization, undo and reject invalid changes atomically',()=>{
 const doc=importJianying(raw()).document,session=createSession(doc),clip=doc.tracks.flatMap(t=>t.clips)[0];
 const edited=session.execute(0,{type:'clip.update',clipId:clip.id,changes:{vignette:{version:'v1',intensity:-.5}}});session.execute(1,{type:'split',clipId:clip.id,at:rational(1),rightId:'right-vignette'});assert(doc.tracks.flatMap(t=>t.clips).length===1);assert(session.snapshot().document.tracks.flatMap(t=>t.clips).every(c=>c.vignette?.intensity===-.5));const a=session.serialize(),restored=createSession(a.document,a);assert.deepEqual(restored.undo(2).document,edited.document);assert.throws(()=>restored.execute(3,{type:'clip.update',clipId:clip.id,changes:{vignette:{version:'v1',intensity:2}}}),/INVALID_VIGNETTE/);assert.equal(restored.snapshot().revision,3);
});
