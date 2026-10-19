import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {importJianying} from '../packages/jianying/src/import.ts';
import {evaluateAnimation, sourceTimeAt} from '../packages/core/src/animation.ts';
import {rational} from '../packages/core/src/time.ts';

function snapshot(name='03-copy-2x') {
  return JSON.parse(fs.readFileSync(new URL(`../evidence/2026-10-19-expansion/${name}.json`, import.meta.url), 'utf8'));
}
function segment(raw:any) {return raw.tracks[1].segments[0];}
function points(raw:any) {return segment(raw).common_keyframes[0].keyframe_list;}
function importedClip(raw:any) {return importJianying(raw).document.tracks[1].clips[0];}
function addY(raw:any) {
  const y=structuredClone(segment(raw).common_keyframes[0]);
  y.id='scale-y';y.property_type='KFTypeScaleY';
  y.keyframe_list.forEach((p:any)=>p.id+='-y');
  segment(raw).common_keyframes.push(y);return y;
}

test('real copied and 2x snapshots import editable source-clock scale without source mutation', () => {
  for(const name of ['00-before-move','01-moved','02-pasted','03-copy-2x','04-copy-2x-split']) {
    const raw=snapshot(name), text=JSON.stringify(raw), before=structuredClone(raw), result=importJianying(raw,text);
    assert.deepEqual(raw,before);assert.deepEqual(result.provenance.raw,before);
    assert.deepEqual(result.diagnostics,[]);
    for(const clip of result.document.tracks.flatMap(t=>t.clips)) {
      assert.equal(clip.editableTiming,true);
    }
  }
  const raw=snapshot(), clip=importedClip(raw);
  assert.deepEqual(clip.animations![0].points.map(p=>p.time),[rational(3),rational(5)]);
  assert(Math.abs(evaluateAnimation(clip.animations![0],sourceTimeAt(clip,rational(7)))-1.25)<1e-12);
  const split=importJianying(snapshot('04-copy-2x-split')).document.tracks[0].clips.slice(2);
  assert.deepEqual(split[0].animations![0].points.map(p=>p.time),[rational(3),rational(4)]);
  assert.deepEqual(split[1].animations![0].points.map(p=>p.time),[rational(4),rational(5)]);
  assert.equal(split[0].animations![0].points.at(-1)!.value,1.125);
  assert.equal(split[1].animations![0].points[0].value,1.125);
});

test('matching X/Y curves are merged once, unknown scale semantics retain a readonly source', () => {
  const known=snapshot();addY(known);
  assert.equal(importedClip(known).animations!.length,1);
  const edits=[
    (d:any)=>{segment(d).clip.scale.y=2;},
    (d:any)=>{addY(d).keyframe_list[1].values[0]=2;},
    (d:any)=>{addY(d).keyframe_list[1].time_offset=4500000;},
    (d:any)=>{segment(d).uniform_scale.on=false;},
    (d:any)=>{segment(d).uniform_scale.value=2;},
    (d:any)=>{segment(d).common_keyframes[0].property_type='KFTypePositionX';},
    (d:any)=>{points(d)[0].curveType='Bezier';},
    (d:any)=>{points(d)[0].left_control.x=.5;},
    (d:any)=>{points(d)[0].graphID='unverified-graph';},
    (d:any)=>{segment(d).common_keyframes[0].material_id='another-material';},
    (d:any)=>{const y=addY(d);y.property_type='KFTypeOpacity';},
    (d:any)=>{segment(d).common_keyframes.push(structuredClone(segment(d).common_keyframes[0]));},
  ];
  for(const edit of edits) {
    const raw=snapshot();edit(raw);const before=structuredClone(raw),result=importJianying(raw),clip=result.document.tracks[1].clips[0];
    assert.equal(clip.editableTiming,false);assert.equal(clip.animations,undefined);
    assert(result.diagnostics.some(d=>d.clipId===clip.id && d.code.startsWith('KEYFRAME_')));
    assert.deepEqual(raw,before);assert.deepEqual(result.provenance.raw,before);
  }
});

test('known video metadata and current uniform scale are mapped without unit guesses', () => {
  const raw=snapshot(),result=importJianying(raw),clip=result.document.tracks[1].clips[0];
  assert.deepEqual(clip.transform,{x:0,y:0,scale:1.2499999999999998,rotation:0,opacity:1,flipX:false,flipY:false});
  assert.equal(clip.volume,1);
  const asset=result.document.assets.find(a=>a.id===clip.materialId)!;
  assert.equal(asset.kind,'video');assert.equal(asset.width,640);assert.equal(asset.height,360);
  assert.equal(asset.hasAudio,true);assert.equal(asset.name,'yingxu-jianying-probe-20261018.mp4');
});

test('only evidenced default visual state is editable without unresolved visual diagnostics', () => {
  const edits=[
    (d:any)=>{segment(d).clip.transform.x=.1;},
    (d:any)=>{segment(d).clip.transform.y=.1;},
    (d:any)=>{segment(d).clip.rotation=90;},
    (d:any)=>{segment(d).clip.alpha=.5;},
    (d:any)=>{segment(d).clip.flip.horizontal=true;},
    (d:any)=>{segment(d).volume=.5;},
    (d:any)=>{segment(d).reverse=true;},
    (d:any)=>{segment(d).hdr_settings.mode=2;},
    (d:any)=>{segment(d).extra_material_refs.push('unknown-effect');},
    (d:any)=>{d.materials.canvases[2].color='#ffffff';},
    (d:any)=>{d.materials.sound_channel_mappings[2].audio_channel_mapping=1;},
    (d:any)=>{d.materials.vocal_separations[2].choice=1;},
    (d:any)=>{d.materials.videos[2].crop.upper_left_x=.1;},
    (d:any)=>{d.materials.videos[2].video_algorithm.noise_reduction={amount:1};},
    (d:any)=>{d.materials.videos[2].matting.flag=1;},
    (d:any)=>{d.materials.videos[2].matting.has_use_quick_brush=true;},
  ];
  for(const edit of edits) {
    const raw=snapshot();edit(raw);const before=structuredClone(raw),result=importJianying(raw);
    assert(result.diagnostics.some(d=>d.clipId===segment(raw).id&&d.code==='VISUAL_SEMANTICS_NOT_INTERPRETED'));
    assert.deepEqual(result.provenance.raw,before);assert.deepEqual(raw,before);
  }
});

test('invalid keyframe order, identifiers, values and asset-clock bounds are rejected', () => {
  const edits=[
    (d:any)=>{points(d).reverse();},
    (d:any)=>{points(d)[1].time_offset=3000000;},
    (d:any)=>{points(d)[1].id=points(d)[0].id;},
    (d:any)=>{points(d)[0].time_offset=-1;},
    (d:any)=>{points(d)[1].time_offset=6000001;},
    (d:any)=>{points(d)[0].time_offset=.5;},
    (d:any)=>{points(d)[1].time_offset=Number.MAX_SAFE_INTEGER+1;},
    (d:any)=>{points(d)[0].values=[NaN];},
    (d:any)=>{points(d)[0].values=[0];},
    (d:any)=>{points(d)[0].values=[11];},
    (d:any)=>{points(d)[0].values=[];},
    (d:any)=>{points(d)[0].values=[1,2];},
    (d:any)=>{segment(d).common_keyframes[0].keyframe_list=[];},
    (d:any)=>{points(d)[0].id='';},
  ];
  for(const edit of edits) {const raw=snapshot();edit(raw);assert.throws(()=>importJianying(raw));}
});

test('valid points outside clip range are preserved because they determine visible interpolation', () => {
  const raw=snapshot();
  points(raw)[0].time_offset=2000000;points(raw)[0].values=[1];
  points(raw)[1].time_offset=6000000;points(raw)[1].values=[2];
  const clip=importedClip(raw);
  assert.deepEqual(clip.animations![0].points.map(p=>p.time),[rational(2),rational(6)]);
  assert.equal(evaluateAnimation(clip.animations![0],sourceTimeAt(clip,rational(6))),1.25);
  assert.equal(evaluateAnimation(clip.animations![0],sourceTimeAt(clip,rational(7))),1.75);
  assert.equal(clip.editableTiming,true);
});
