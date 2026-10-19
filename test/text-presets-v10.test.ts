import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rational as r} from '../packages/core/src/time.ts';
import {textAnimationLetterOpacities,textAnimationOffsetY,textAnimationState,validateTextAnimations,type TextAnimation} from '../packages/core/src/text-animation.ts';
import {captionScript} from '../packages/media/src/captions.ts';
import {defaultTransform} from '../packages/core/src/document.ts';
import type {Layer} from '../packages/media/src/graph.ts';
const soft:TextAnimation={phase:'in',kind:'typewriter-soft',duration:r(1,2)},shrink:TextAnimation={phase:'out',kind:'zoom-out',duration:r(1,2)};
const evidence=(name:string)=>JSON.parse(fs.readFileSync(new URL(`../evidence/2026-10-19-text-presets-v10/${name}.json`,import.meta.url),'utf8'));

test('native typewriter II quartic per-entry alpha matches six Han and preserves the failed Floor hypothesis',()=>{
 const record=evidence('typewriter2-native-six');assert.equal(record.frames,120);
 for(const row of record.rows){const actual=textAnimationLetterOpacities([soft],'文字动画对照',r(row.frame,30))!;
  row.observedAlpha.forEach((observed:number,i:number)=>assert(Math.abs(actual[i]-observed)<.025,`${row.frame}/${i}`));
 }
 assert(record.errors.floor.maxAlpha>.7);assert(record.errors.quartic.maxAlpha<.025);
});

test('native mixed typewriter II counts spaces and LF without collapsing render entries',()=>{
 const record=evidence('typewriter2-native-mixed');assert.equal(record.text,'AB C中文\nD EFG');
 const visible=[0,1,3,4,5,7,9,10,11];
 for(const row of record.rows){const actual=textAnimationLetterOpacities([soft],record.text,r(row.frame,30))!;
  row.observedAlpha.forEach((observed:number,i:number)=>assert(Math.abs(actual[visible[i]]-observed)<.025,`${row.frame}/${visible[i]}`));
 }
 for(const text of ['a\u0301','𠮷','👩‍💻','\r','\t'])assert.throws(()=>textAnimationLetterOpacities([soft],text,r(1)),/GLYPHS_UNVERIFIED/);
 assert.equal(textAnimationLetterOpacities(undefined,'A',r(0)),undefined);
 assert.deepEqual(textAnimationLetterOpacities([soft],'ABC',r(-1)),[0,0,0]);
 assert.deepEqual(textAnimationLetterOpacities([soft],'ABC',r(1)),[1,1,1]);
});

test('native shrink exit uses quadIn alpha and scale, preserving the failed old fade-tail model',()=>{
 const record=evidence('shrink-out-native');assert.equal(record.frames,120);
 for(const row of record.rows){const actual=textAnimationState([shrink],r(row.frame,30),r(4));
  assert(Math.abs(actual.opacity-row.observedInteriorMedianAlpha)<.025,`${row.frame}`);
  if(row.frame>=105)row.boundsHalfAlpha.forEach((observed:number,i:number)=>assert(Math.abs(observed-(i%2===0?640:360)- (record.referenceBounds128[i]-(i%2===0?640:360))*actual.scale)<1.5,`${row.frame}/${i}`));
 }
 assert(record.oldFadeTailAlphaMaxError>.49);assert.deepEqual(textAnimationState([shrink],r(4),r(4)),{opacity:0,scale:.5});
 for(const kind of ['typewriter-soft','zoom-out'])for(const phase of ['in','out','loop']){
  const valid=kind==='typewriter-soft'?phase==='in':phase==='out';
  if(valid)assert.doesNotThrow(()=>validateTextAnimations([{kind,phase,duration:r(1,2)}],r(4)));
  else assert.throws(()=>validateTextAnimations([{kind,phase,duration:r(1,2)}],r(4)),/KIND_UNVERIFIED/);
 }
});

export function presetLayer(animations:TextAnimation[],content='AB C中文\nD EFG'):Layer{
 return {asset:{id:'text',path:'',kind:'text',duration:r(4)},clip:{id:'text-clip',materialId:'text',source:{start:r(0),duration:r(4)},target:{start:r(0),duration:r(4)},speed:r(1),editableTiming:true,transform:{...defaultTransform(),opacity:.713},text:{content,font:'Arial',size:32,color:'#ffffff',outline:0,shadow:0,lineHeight:40},textAnimations:animations}} as Layer;
}
test('ASS multiplies raw common alpha before each letter quantization and retains full-line advances',()=>{
 const layer=presetLayer([soft,shrink]),script=captionScript([layer],{width:320,height:180},r(30));
 const rows=script.split('\n').filter(l=>l.startsWith('Dialogue:'));
 const firstLine=rows.find(l=>l.includes(',0:00:00.10,0:00:00.13,'))!;
 const alphas=Array.from(firstLine.matchAll(/\\alpha&H([0-9a-f]{2})&/g),m=>parseInt(m[1],16));
 const values=textAnimationLetterOpacities([soft],'AB C中文\nD EFG',r(1,10))!;
 assert.deepEqual(alphas.slice(1),values.slice(0,6).map(v=>Math.round((1-.713*v)*255)));
 assert(firstLine.includes('A')&&firstLine.includes('B')&&firstLine.includes('中')&&firstLine.includes('文'));
 const lastLine=rows.find(l=>l.includes(',0:00:03.96,0:00:04.00,'))!;
 assert(lastLine.includes('\\fscx56.44444444444444'));
});


test('native bounce step timings and native exit position retention match both rational combinations',()=>{
 const bounce:TextAnimation={phase:'loop',kind:'bounce',duration:r(1,2)};
 for(const row of evidence('bounce-native').rows)assert(Math.abs(textAnimationOffsetY([bounce],r(row.frame,30),r(4),r(30))*1280-row.relativeDyFit)<.11,`${row.frame}`);
 for(const [file,entrance,period]of [['bounce-combo-native',r(3,10),r(7,10)],['bounce-half-combo-native',r(1,2),r(1)]]as const){
  const combo:TextAnimation[]=[{...soft,duration:entrance},{...bounce,duration:period},{...shrink,duration:r(2,5)}];
  validateTextAnimations(combo,r(4));
  for(const row of evidence(file).rows)assert(Math.abs(textAnimationOffsetY(combo,r(row.frame,30),r(4),r(30))*1280-row.dyFit)<.26,`${file}/${row.frame}`);
 }
 const combo:TextAnimation[]=[{...soft,duration:r(3,10)},{...bounce,duration:r(7,10)},{...shrink,duration:r(2,5)}];
 assert.equal(textAnimationOffsetY(combo,r(18,5),r(4),r(30))*1280,9.6);
 // The source clip can begin between grid ticks: the final loop sample is found
 // from the absolute output grid, not by rounding the local elapsed time.
 assert.equal(textAnimationOffsetY(combo,r(18,5),r(4),r(30),r(1,100))*1280,6.4);
 assert.equal(textAnimationState([bounce],r(1,10),r(4)).opacity,1);
});


test('native bounce geometry uses longest output side and the source scale/rotation before exit preset scaling',()=>{
 const bounce:TextAnimation={phase:'loop',kind:'bounce',duration:r(1,2)};
 for(const file of ['bounce-portrait-native','bounce-square-native']){const record=evidence(file);
  for(const row of record.rows)assert(Math.abs(textAnimationOffsetY([bounce],r(row.frame,30),r(4),r(30))*Math.max(record.width,record.height)-row.dyFit)<.11,`${file}/${row.frame}`);
 }
 const record=evidence('bounce-transform-native');
 for(const row of record.rows){const offset=textAnimationOffsetY([bounce],r(row.frame,30),r(4),r(30))*1280,angle=Math.PI/6;
  assert(Math.abs(-Math.sin(angle)*2*offset-row.dx)<.1,`${row.frame}/x`);
  assert(Math.abs(Math.cos(angle)*2*offset-row.dy)<.1,`${row.frame}/y`);
 }
 const layer=presetLayer([{...soft,duration:r(3,10)},{...bounce,duration:r(7,10)},{...shrink,duration:r(2,5)}],'文字动画对照');
 Object.assign(layer.clip.transform!,{scale:2,rotation:30});
 const script=captionScript([layer],{width:1280,height:720},r(30));
 const line=script.split('\n').find(l=>l.startsWith('Dialogue:')&&l.includes(',0:00:03.80,0:00:03.83,'))!;
 const pos=/\\pos\(([^,]+),([^)]*)\)/.exec(line)!;
 assert(Math.abs(Number(pos[1])-(640-9.6))<1e-10);
 assert(Math.abs(Number(pos[2])-(360+Math.sqrt(3)*9.6))<1e-10);
});

test('real product MP4 keeps separate font baseline and measured alpha/geometry residuals',()=>{
 const record=evidence('product-observations');assert.equal(record.cases.length,2);
 for(const c of record.cases){assert.equal(c.frames,120);assert(c.maxAlphaError<.025);assert.deepEqual(c.referenceBounds,[515,341,764,379]);}
 assert(record.cases.find((c:{case:string})=>c.case==='shrink').tailMaxBoundsError<=1.01);
});

test('actual mixed combination retains original 12-entry entrance clock and native loop/output phases',()=>{
 const record=evidence('mixed-combo-native'),entrance:TextAnimation={...soft,duration:r(3,10)};
 const visible=[0,1,3,4,5,7,9,10,11];
 for(const row of record.alphaRows){const actual=textAnimationLetterOpacities([entrance],record.text,r(row.frame,30))!;
  row.observed.forEach((observed:number,i:number)=>assert(Math.abs(observed-actual[visible[i]])<.025,`${row.frame}/${visible[i]}`));
 }
 assert(record.maxMixedVsHanDyFitError<.11);
});

test('product bounce MP4 and complex combination retain the independently measured native positions',()=>{
 const record=evidence('product-bounce-observations');assert.equal(record.cases.length,2);
 for(const c of record.cases)assert(c.maxNativeDyFitError<.16,c.case);
 const combo=record.cases.find((c:{case:string})=>c.case==='soft-bounce-shrink');
 assert.equal(combo.rows.find((r:{frame:number})=>r.frame===108).nativeDyFit,9.6);
 assert.equal(combo.rows.find((r:{frame:number})=>r.frame===119).nativeDyFit,9.4);
});
