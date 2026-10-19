import test from 'node:test';
import assert from 'node:assert/strict';
import {colorUniforms,validatePixelPoints,colorShader} from '../apps/editor/src/preview/color.ts';
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
 let parameterIndex=0;for(const stage of stages){if(stage.kind==='saturation')assert(Math.abs(uniform.parameters[parameterIndex++]-stage.factor)<1e-7);else if(stage.kind==='brightness'||stage.kind==='highlight'||stage.kind==='shadow')assert(Math.abs(uniform.parameters[parameterIndex++]-stage.exponent)<1e-7);}assert.equal(uniform.brightnessOffset,stages[0].kind==='brightness'?stages[0].inputOffset:NaN);
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


test('GPU tones parameters keep affine control-point math and fade after temperature',()=>{
 const neutral=colorUniforms();assert.equal(neutral.blackWhiteEnabled,false);assert.equal(neutral.fadeEnabled,false);
 const u=colorUniforms({version:'combine-adjust-v2',black:-1,white:1,temperature:1,fade:1});
 assert.equal(u.blackWhiteEnabled,true);assert.equal(u.fadeEnabled,true);assert.equal(u.fadeAmount,1);
 assert(Math.abs(u.blackWhite[0]-200)<1e-4);assert(Math.abs(u.blackWhite[1]+99)<1e-4);
 assert(colorShader.indexOf('if(u_fxBlackWhiteEnabled)')>colorShader.indexOf('if(u_fxEnabled.w)'));
 assert(colorShader.indexOf('if(u_fxTemperatureEnabled)')>colorShader.indexOf('if(u_fxBlackWhiteEnabled)'));
 assert(colorShader.indexOf('if(u_fxFadeEnabled)')>colorShader.indexOf('if(u_fxTemperatureEnabled)'));
 const stages=colorAdjustmentStages({version:'combine-adjust-v2',highlight:1,shadow:1,black:1,temperature:1,fade:1});assert.deepEqual(stages.map(s=>s.kind),['highlight','shadow','blackWhite','temperatureTint','fade']);
 assert.equal(applyColorAdjustments([0,0,0],{version:'combine-adjust-v2',fade:1})[0],69/255);assert.equal(applyColorAdjustments([1,1,1],{version:'combine-adjust-v2',fade:1})[0],218/255);
});
