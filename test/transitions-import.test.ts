import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {importJianying} from '../packages/jianying/src/import.ts';
import {isKnownTransitionMaterial} from '../packages/jianying/src/transitions.ts';
import {micros} from '../packages/core/src/time.ts';
const raw=()=>JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-transitions/06-dissolve-ui-1s.json',import.meta.url),'utf8'));

test('real 5.9.0 dissolve resource projects explicit adjacent pair without changing source or target',()=>{
  for(const file of ['04-dissolve-default.json','06-dissolve-ui-1s.json']){
    const source=JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-transitions/'+file,import.meta.url),'utf8'));
    const before=structuredClone(source),imported=importJianying(source),t=imported.document.transitions![0],segments=source.tracks[0].segments;
    assert.deepEqual(imported.diagnostics,[]);assert.equal(t.kind,'crossfade');assert.equal(t.outgoingClipId,segments[0].id);assert.equal(t.incomingClipId,segments[1].id);
    assert.deepEqual(t.duration,micros(source.materials.transitions[0].duration));
    for(let i=0;i<2;i++){
      const clip=imported.document.tracks[0].clips[i],s=segments[i];
      assert.deepEqual(clip.source,{start:micros(s.source_timerange.start),duration:micros(s.source_timerange.duration)});
      assert.deepEqual(clip.target,{start:micros(s.target_timerange.start),duration:micros(s.target_timerange.duration)});
      assert.equal(clip.transform?.scale,1);assert.equal(clip.editableTiming,true);
    }
    assert.deepEqual(source,before);assert.deepEqual(imported.provenance.raw,source);
  }
});

test('unknown identities, alignment and fields retain provenance and block affected timing',()=>{
  const changes=[{resource_id:'other'},{effect_id:'other'},{name:'闪黑'},{path:'/other/effect/322577/unknown'},{is_overlap:false},{new_shader_parameter:1}];
  for(const change of changes){
    const source=raw();Object.assign(source.materials.transitions[0],change);assert.equal(isKnownTransitionMaterial(source.materials.transitions[0]),false);
    const imported=importJianying(source);assert.equal(imported.document.transitions,undefined);assert(imported.diagnostics.some(d=>d.code==='TRANSITION_UNSUPPORTED'));
    assert(imported.document.tracks[0].clips.every(c=>!c.editableTiming));assert.deepEqual(imported.provenance.raw,source);
  }
});

test('recognized native resource with unsafe source handles stays diagnosed rather than clamped',()=>{
  const source=raw();source.tracks[0].segments[1].source_timerange.start=0;
  const imported=importJianying(source);assert.equal(imported.document.transitions,undefined);
  assert(imported.diagnostics.some(d=>d.code==='TRANSITION_SOURCE_HANDLES_MISSING'));
  assert.equal(imported.document.tracks[0].clips[1].source.start.numerator,'0');
});

test('recognized material cannot infer missing next clip or evade duplicate reference checks',()=>{
  const source=raw();source.tracks[0].segments.pop();
  assert(importJianying(source).diagnostics.some(d=>d.code==='INVALID_TRANSITION'));
  const duplicate=raw();duplicate.materials.transitions.push({...duplicate.materials.transitions[0]});
  assert(importJianying(duplicate).diagnostics.some(d=>d.code==='TRANSITION_UNSUPPORTED'));
});

test('real flash-black uses nonoverlap mode and preserves semitransparent foreground above a lower track',()=>{
 const source=JSON.parse(fs.readFileSync(new URL('../evidence/2026-10-19-transitions/18-alpha-flash-native.json',import.meta.url),'utf8')),result=importJianying(source);
 assert.deepEqual(result.diagnostics,[]);assert.equal(result.document.tracks.length,2);assert.equal(result.document.transitions![0].kind,'dipToBlack');assert.equal(result.document.transitions![0].overlap,false);
 assert.deepEqual(result.document.tracks[1].clips.map(c=>c.transform?.opacity),[.5,.5]);assert.deepEqual(result.provenance.raw,source);
});
