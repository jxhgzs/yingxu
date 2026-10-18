import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument, defaultTransform, validateDocument} from '../packages/core/src/document.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {rational} from '../packages/core/src/time.ts';
import {newTextClip} from '../packages/core/src/edits.ts';

test('multi-track editing, trim, move and locks are transactional', () => {
  let doc = applyCommand(emptyDocument(), {type: 'asset.add', asset: {id: 'a', path: '/fixture', duration: rational(20), kind: 'video'}});
  doc = applyCommand(doc, {type: 'clip.add', trackId: 'video-main', clip: {
    id: 'c', materialId: 'a', source: {start: rational(2), duration: rational(6)}, target: {start: rational(0), duration: rational(6)}, speed: rational(1), editableTiming: true
  }});
  doc = applyCommand(doc, {type: 'clip.trim', clipId: 'c', sourceStart: rational(3), sourceDuration: rational(4)});
  assert.deepEqual(doc.tracks[0].clips[0].target.duration, rational(4));
  doc = applyCommand(doc, {type: 'track.add', track: {id: 'overlay', kind: 'video', clips: []}});
  doc = applyCommand(doc, {type: 'clip.move', clipId: 'c', trackId: 'overlay', start: rational(1)});
  assert.equal(doc.tracks[0].clips.length, 0);
  doc = applyCommand(doc, {type: 'clip.update', clipId: 'c', changes: {transform: {...defaultTransform(), scale: 1.2}}});
  doc = applyCommand(doc, {type: 'track.update', trackId: 'overlay', changes: {locked: true}});
  const before = structuredClone(doc);
  assert.throws(() => applyCommand(doc, {type: 'clip.remove', clipId: 'c', ripple: false}), /TRACK_LOCKED/);
  assert.deepEqual(doc, before);
  assert.throws(() => applyCommand(doc, {type: 'track.update', trackId: 'overlay', changes: {hidden: 'yes'} as any}));
});
test('text and independent audio coexist with video and reject invalid style', () => {
  let d = applyCommand(emptyDocument(), {type: 'asset.add', asset: {id: 'text', path: '', kind: 'text', duration: rational(3600)}});
  d = applyCommand(d, {type: 'clip.add', trackId: 'text-main', clip: {id: 't', materialId: 'text',
    source: {start: rational(0), duration: rational(4)}, target: {start: rational(1), duration: rational(4)},
    speed: rational(1), editableTiming: true, text: {content: '映序 字幕', font: 'PingFang SC', color: '#ffffff', size: 54}}});
  validateDocument(d);
  assert.throws(() => applyCommand(d, {type: 'clip.update', clipId: 't', changes: {text: {...d.tracks[2].clips[0].text!, color: 'red'}}}));
  assert.throws(() => applyCommand(d, {type: 'clip.move', clipId: 't', trackId: 'audio-main', start: rational(0)}), /TRACK_KIND_MISMATCH/);
});
test('new text fits a fractional remaining range without extending into a black tail', () => {
  const d = emptyDocument();d.assets.push({id:'a',path:'/fixture',duration:rational(6)});
  d.tracks[0].clips.push({id:'c',materialId:'a',source:{start:rational(0),duration:rational(9,2)},target:{start:rational(0),duration:rational(9,2)},speed:rational(1),editableTiming:true});
  const clip = newTextClip(d,'text','t',rational(3));
  assert.deepEqual(clip.target.duration,rational(3,2));
  assert.deepEqual(newTextClip(d,'text','t',rational(9,2)).target,{start:rational(1,2),duration:rational(4)});
});
