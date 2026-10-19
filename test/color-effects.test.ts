import test from 'node:test';
import assert from 'node:assert/strict';
import {applyColorAdjustments,colorAdjustmentStages,hasColorAdjustments,normalizeColorAdjustments,validateColorAdjustments} from '../packages/core/src/color-effects.ts';
import type {ColorAdjustments,RGB} from '../packages/core/src/color-effects.ts';
const adjust=(fields:Omit<ColorAdjustments,'version'>):ColorAdjustments=>({version:'combine-adjust-v2',...fields});
const near=(actual:RGB,expected:RGB,tolerance=2e-14)=>actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<=tolerance,`${value} != ${expected[i]}`));

test('versioned adjustments validate strictly and normalize without mutating callers',()=>{
  assert.deepEqual(normalizeColorAdjustments(),{version:'combine-adjust-v2',brightness:0,saturation:0,highlight:0,shadow:0});
  const input=Object.freeze(adjust({brightness:.5}));
  assert.equal(normalizeColorAdjustments(input).saturation,0);assert.deepEqual(input,adjust({brightness:.5}));
  assert.equal(hasColorAdjustments(input),true);assert.equal(hasColorAdjustments(adjust({brightness:1e-5,shadow:-1e-5})),false);
  for(const input of [undefined,null,[],{}, {version:'other'},adjust({brightness:NaN}),adjust({highlight:Infinity}),adjust({shadow:1.0001}),adjust({saturation:-1.0001}),{version:'combine-adjust-v2',brightness:'0.5'},{version:'combine-adjust-v2',contrast:0}])assert.throws(()=>validateColorAdjustments(input),/INVALID_COLOR_ADJUSTMENTS/);
  for(const rgb of [[-1,0,0],[0,NaN,0],[0,0,1.1],[0,1],[0,1,0,1]])assert.throws(()=>applyColorAdjustments(rgb as unknown as RGB),/INVALID_COLOR_RGB/);
});

test('neutral values preserve normalized black, white, grey and coloured inputs exactly',()=>{
  for(const rgb of [[0,0,0],[1,1,1],[.5,.5,.5],[.2,.4,.8]] as const){
    near(applyColorAdjustments(rgb),rgb,0);near(applyColorAdjustments(rgb,adjust({})),rgb,0);
    near(applyColorAdjustments(rgb,adjust({brightness:1e-5,saturation:-1e-5})),rgb,0);
    if(rgb[0]===rgb[1]&&rgb[1]===rgb[2]&&(rgb[0]===0||rgb[0]===1))near(applyColorAdjustments(rgb,adjust({brightness:1,saturation:1,highlight:1,shadow:1})),rgb,0);
  }
});

test('brightness matches independent high precision scalar values including branch limits',()=>{
  // Decimal 60-digit oracle of the documented mathematics, not target render observations.
  for(const [amount,expected] of [[-1,.17501011891596552],[-.5,.2618757029040071],[.5,.7026982212493197],[.7,.7585159177687886],[1,.875]]){
    near(applyColorAdjustments([.5,.5,.5],adjust({brightness:amount})),[expected,expected,expected]);
  }
  near(applyColorAdjustments([0,0,0],adjust({brightness:-1})),[0,0,0],0);
  near(applyColorAdjustments([1,1,1],adjust({brightness:1})),[1,1,1],0);
  assert.ok(applyColorAdjustments([.5,.5,.5],adjust({brightness:.700001}))[0]>.7585);
});

test('saturation uses fixed luminance and clips channels before later stages',()=>{
  near(applyColorAdjustments([1,0,0],adjust({saturation:-1})),[.208540,.208540,.208540]);
  near(applyColorAdjustments([.2,.4,.8],adjust({saturation:-1})),[.3940416,.3940416,.3940416]);
  near(applyColorAdjustments([1,0,0],adjust({saturation:1})),[1,0,0],0);
  near(applyColorAdjustments([.5,.5,.5],adjust({saturation:1})),[.5,.5,.5]);
  near(applyColorAdjustments([.2,.4,.8],adjust({saturation:.5})),[.1029792,.4029792,1]);
});

test('highlight and shadow retain separate polynomial mappings and fixed stage order',()=>{
  near(applyColorAdjustments([.5,.5,.5],adjust({highlight:.5})),[.5594364397604253,.5594364397604253,.5594364397604253]);
  near(applyColorAdjustments([.5,.5,.5],adjust({shadow:.5})),[.5548493771619053,.5548493771619053,.5548493771619053]);
  near(applyColorAdjustments([.5,.5,.5],adjust({highlight:-.5})),[.4451506228380947,.4451506228380947,.4451506228380947]);
  near(applyColorAdjustments([.5,.5,.5],adjust({shadow:-.5})),[.44056356023957465,.44056356023957465,.44056356023957465]);
  const all=adjust({brightness:.6,saturation:.7,highlight:-.4,shadow:.5}),input:RGB=[.15,.4,.8];
  const expected=applyColorAdjustments(applyColorAdjustments(applyColorAdjustments(applyColorAdjustments(input,adjust({brightness:.6})),adjust({saturation:.7})),adjust({highlight:-.4})),adjust({shadow:.5}));
  near(applyColorAdjustments(input,all),expected,0);
  const reversed=applyColorAdjustments(applyColorAdjustments(input,adjust({saturation:.7})),adjust({brightness:.6}));
  const ordered=applyColorAdjustments(input,adjust({brightness:.6,saturation:.7}));
  assert.ok(ordered.some((c,i)=>Math.abs(c-reversed[i])>.01));
  assert.deepEqual(colorAdjustmentStages(all).map(stage=>stage.kind),['brightness','saturation','highlight','shadow']);
  for(let i=0;i<=30;i++)for(const amount of [-1,1]){
    const value=applyColorAdjustments([i/30,.2,1-i/30],adjust({brightness:amount,saturation:amount,highlight:amount,shadow:amount}));
    assert.ok(value.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
  }
});
