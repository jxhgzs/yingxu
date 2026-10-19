import test from 'node:test';
import assert from 'node:assert/strict';
import {applyContrastChannel,contrastFactor,contrastParameters,CONTRAST_PIVOT} from '../packages/core/src/color-contrast.ts';

const near=(actual:number,expected:number,tolerance=5e-15)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected} (tolerance ${tolerance})`);

test('contrast accepts only finite normalized intensity and channel inputs',()=>{
  for(const bad of [NaN,Infinity,-Infinity,-1.00001,1.00001,'0',null,undefined]){
    assert.throws(()=>contrastFactor(bad as number),/INVALID_COLOR_CONTRAST_INTENSITY/);
    assert.throws(()=>contrastParameters(bad as number),/INVALID_COLOR_CONTRAST_INTENSITY/);
    assert.throws(()=>applyContrastChannel(.5,bad as number),/INVALID_COLOR_CONTRAST_INTENSITY/);
  }
  for(const bad of [NaN,Infinity,-Infinity,-Number.EPSILON,1+Number.EPSILON,'0',null,undefined])assert.throws(()=>applyContrastChannel(bad as number,.5),/INVALID_COLOR_CHANNEL/);
  assert.equal(contrastFactor(-1),.6);assert.equal(contrastFactor(0),1);assert.equal(contrastFactor(1),1.6);
  near(contrastFactor(-.5),.8);near(contrastFactor(.5),1.3);
});

test('neutral is exact and negative contrast is an affine contraction around the fixed pivot',()=>{
  assert.equal(CONTRAST_PIVOT,.435);
  for(const amount of [0,-0,Number.MIN_VALUE,-Number.MIN_VALUE])for(const input of [0,Number.EPSILON,.1,.435,.5,.9,1])assert.equal(applyContrastChannel(input,amount),input);
  // Hand-derived affine anchors: i=-1 maps the endpoints to .174/.774;
  // halfway between the input endpoints must map to their output midpoint.
  const anchors:[number,number,number][]=[[-1,0,.174],[-1,1,.774],[-1,.5,.474],[-.5,0,.087],[-.5,1,.887],[-.5,.5,.487],[-.5,.25,.287]];
  for(const [amount,input,expected] of anchors)near(applyContrastChannel(input,amount),expected);
  for(const amount of [-1,-.5,-.001])near(applyContrastChannel(.25,amount)+applyContrastChannel(.75,amount),2*applyContrastChannel(.5,amount));
});

test('positive contrast matches independently retained 80-digit Decimal scalar anchors',()=>{
  // Offline Decimal(precision=80) mathematical oracle; these are not native
  // rendered pixels. No exp/sigmoid implementation is repeated in this test.
  const anchors:[number,number,number][]=[
    [.5,.0625,.027740291949128623200176341995424],
    [.5,.25,.17902894008649645470027684356460],
    [.5,.5,.53318807691882664715500431559708],
    [.5,.75,.84571639186723816885309295557277],
    [.5,.9375,.97570194359105531728448025680026],
    [1,.0625,.0047411717991550322613982114849261],
    [1,.25,.074512222481249519501408795669367],
    [1,.5,.60462752868031495866266404646422],
    [1,.75,.95529543921830946033231916174353],
    [1,.9375,.99671661060501055054473656050225],
  ];
  for(const [amount,input,expected] of anchors)near(applyContrastChannel(input,amount),expected);
});

test('near-zero positive branch is preserved; stage enable epsilon belongs to the caller',()=>{
  near(applyContrastChannel(.25,.00002),.24787656543117794921078801575124);
  near(applyContrastChannel(.75,.00002),.75630953282702503151311308429821);
  near(applyContrastChannel(.25,-.00002),.25000148);
  // The recovered positive curve has a small jump from the exact neutral
  // branch. Smoothing it would change the observed mathematics.
  assert.ok(applyContrastChannel(.9375,1e-6)>.944);
  assert.equal(applyContrastChannel(.9375,0),.9375);
  const params=contrastParameters(.5);
  assert.equal(params.factor,1.3);assert.equal(params.pivot,CONTRAST_PIVOT);
  near(params.pivotSlope,params.xFactor/4);
  assert.ok(params.leftSlopeDiff>0&&params.rightSlopeDiff>0);
  // Returned parameter objects do not retain mutable shared state.
  const changed={...params};changed.pivot=0;
  assert.equal(contrastParameters(.5).pivot,CONTRAST_PIVOT);
});

test('201 intensity by 4097 channel grid stays finite, bounded and monotonic with fixed pivot',()=>{
  for(let step=0;step<=200;step++){
    const amount=(step-100)/100;
    near(applyContrastChannel(CONTRAST_PIVOT,amount),CONTRAST_PIVOT);
    if(amount>0){assert.equal(applyContrastChannel(0,amount),0);assert.equal(applyContrastChannel(1,amount),1);}
    let previous=-Infinity;
    for(let sample=0;sample<=4096;sample++){
      const value=applyContrastChannel(sample/4096,amount);
      assert.ok(Number.isFinite(value)&&value>=0&&value<=1,`range at ${amount}/${sample}`);
      assert.ok(value+1e-14>=previous,`monotonic at ${amount}/${sample}`);previous=value;
    }
  }
});
