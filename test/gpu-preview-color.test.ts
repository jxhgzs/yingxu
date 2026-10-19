import test from 'node:test';
import assert from 'node:assert/strict';
import {colorUniforms,validatePixelPoints} from '../apps/editor/src/preview/color.ts';
import {colorAdjustmentStages,applyColorAdjustments} from '../packages/core/src/color-effects.ts';
import {contrastParameters} from '../packages/core/src/color-contrast.ts';
import {createPreviewPlan,previewFrame} from '../apps/editor/src/preview/plan.ts';
import {emptyDocument} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';

test('GPU adjustment uniforms preserve shared stage order/parameters and neutral bypass',()=>{
 const neutral=colorUniforms({version:'combine-adjust-v2',brightness:0,saturation:0,highlight:0,shadow:0});assert.deepEqual([...neutral.mask],[0,0,0,0]);assert.deepEqual([...neutral.parameters],[1,1,1,1]);
 assert.equal(neutral.contrastEnabled,false);
 const adjustment={version:'combine-adjust-v2' as const,brightness:-.6,contrast:.7,saturation:.5,highlight:.4,shadow:-.3},uniform=colorUniforms(adjustment),stages=colorAdjustmentStages(adjustment);
 assert.deepEqual([...uniform.mask],[1,1,1,1]);assert.deepEqual(stages.map(s=>s.kind),['brightness','contrast','saturation','highlight','shadow']);
 stages.filter(s=>s.kind!=='contrast').forEach((s,i)=>assert(Math.abs(uniform.parameters[i]-(s.kind==='saturation'?s.factor:s.exponent))<1e-7));assert.equal(uniform.brightnessOffset,stages[0].kind==='brightness'?stages[0].inputOffset:NaN);
 const contrast=contrastParameters(.7);assert.equal(uniform.contrastEnabled,true);[contrast.factor,contrast.pivot,contrast.xFactor,contrast.pivotSlope].forEach((v,i)=>assert.ok(Math.abs(uniform.contrastA[i]-v)<1e-5));[contrast.leftDiff,contrast.rightDiff,contrast.leftSlopeDiff,contrast.rightSlopeDiff].forEach((v,i)=>assert.ok(Math.abs(uniform.contrastB[i]-v)<1e-5));
 assert.equal(colorUniforms({version:'combine-adjust-v2',contrast:1e-5}).contrastEnabled,false);
 // Saturation -1 has a useful independent oracle: every output equals weighted luminance.
 const grey=applyColorAdjustments([1,0,0],{version:'combine-adjust-v2',saturation:-1});assert.deepEqual(grey,[.20854,.20854,.20854]);
 assert.throws(()=>colorUniforms({version:'combine-adjust-v2',brightness:2}),/INVALID_COLOR_ADJUSTMENTS/);
});
test('supported GPU plan retains versioned color adjustments on the actual layer',()=>{
 const doc=emptyDocument();doc.assets.push({id:'v',kind:'video',path:'/not-open.mp4',duration:rational(2),width:320,height:180});
 doc.tracks[0].clips.push({id:'c',materialId:'v',source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true,colorAdjustments:{version:'combine-adjust-v2',brightness:.5}});
 const result=createPreviewPlan(doc);assert(result.support.supported);assert.equal(previewFrame(result.plan!,rational(1)).layers[0].clip.colorAdjustments?.brightness,.5);
 validatePixelPoints([{x:0,y:0}],1,1);assert.throws(()=>validatePixelPoints([{x:.5,y:0}],1,1),/POINTS_INVALID/);
});
