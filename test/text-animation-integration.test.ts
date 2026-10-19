import test from 'node:test';
import assert from 'node:assert/strict';
import {rational as r} from '../packages/core/src/time.ts';
import {emptyDocument,defaultTransform,validateDocument} from '../packages/core/src/document.ts';
import {applyCommand} from '../packages/core/src/commands.ts';
import {captionScript} from '../packages/media/src/captions.ts';
import {renderGraph} from '../packages/media/src/graph.ts';

function document(){const doc=emptyDocument();doc.canvas={width:1280,height:720};
 doc.assets=[{id:'text',kind:'text',path:'',duration:r(20)}];doc.tracks=[{id:'t',kind:'text',clips:[{id:'c',materialId:'text',source:{start:r(0),duration:r(2)},target:{start:r(3),duration:r(2)},speed:r(1),editableTiming:true,transform:defaultTransform(),text:{content:'文字动画对照',font:'Arial',size:54,color:'#ffffff',outline:0,shadow:0}}]}];return doc;}
test('text presets are typed, atomically editable and retain target-clock timing on move',()=>{
 const doc=document(),next=applyCommand(doc,{type:'clip.update',clipId:'c',changes:{textAnimations:[{phase:'in',kind:'fade',duration:r(1,2)},{phase:'out',kind:'fade',duration:r(1,2)}]}});
 assert.equal(doc.tracks[0].clips[0].textAnimations,undefined);validateDocument(next);
 const moved=applyCommand(next,{type:'clip.move',clipId:'c',trackId:'t',start:r(7)});assert.deepEqual(moved.tracks[0].clips[0].textAnimations,next.tracks[0].clips[0].textAnimations);
 for(const command of [{type:'split',clipId:'c',at:r(4),rightId:'right'},{type:'clip.trim',clipId:'c',sourceStart:r(0),sourceDuration:r(1)},{type:'speed',clipId:'c',value:r(2),shiftFollowing:false}] as const)assert.throws(()=>applyCommand(next,command),/TEXT_ANIMATION_TIMING_EDIT_UNVERIFIED/);
 const removed=applyCommand(next,{type:'clip.update',clipId:'c',changes:{textAnimations:[]}});assert.equal(removed.tracks[0].clips[0].textAnimations?.length,0);
 const invalid=structuredClone(next);invalid.tracks[0].kind='video';invalid.assets[0].kind='video';assert.throws(()=>validateDocument(invalid),/TEXT_ANIMATION_MEDIA_UNSUPPORTED/);
});
test('ASS uses measured quadratic target alpha and invisible glyph suffixes without prefix reflow',()=>{
 const doc=document(),clip=doc.tracks[0].clips[0];clip.textAnimations=[{phase:'in',kind:'fade',duration:r(1,2)}];
 const script=captionScript(renderGraph(doc).layers,doc.canvas,doc.fps),lines=script.split('\n').filter(l=>l.startsWith('Dialogue:'));
 assert.equal(lines.length,60);assert.match(lines[0],/0:00:03\.00,0:00:03\.03.*\\alpha&Hff&/i);
 // At elapsed 0.1 seconds alpha=.36 -> 8bit ASS transparency 163 (A3).
 assert.match(lines[3],/\\alpha&Ha3&/i);assert.match(lines[15],/\\alpha&H00&/i);
 clip.textAnimations=[{phase:'in',kind:'typewriter',duration:r(1,2)}];const typed=captionScript(renderGraph(doc).layers,doc.canvas,doc.fps).split('\n').filter(l=>l.startsWith('Dialogue:'));
 assert.match(typed[0],/\\alpha&Hff&/i);assert.match(typed[3],/文.*\\alpha&Hff&.*字动画对照/i);
 assert.match(typed[13],/文字动画对照/);assert.equal(typed.length,60);
});
