import test from 'node:test';
import assert from 'node:assert/strict';
import {temperatureKelvin,temperatureTintWhitepoint,temperatureTintMatrix,applyTemperatureTint,type TemperatureRgb} from '../packages/core/src/color-temperature.ts';

const near=(actual:number,expected:number,tolerance=5e-15)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const vectorNear=(actual:readonly number[],expected:readonly number[])=>actual.forEach((value,index)=>near(value,expected[index]));

test('temperature candidate accepts only finite normalized inputs and RGB triplets',()=>{
  for(const bad of [NaN,Infinity,-Infinity,-1.00001,1.00001,'0',null,undefined]){
    assert.throws(()=>temperatureKelvin(bad as number),/INVALID_COLOR_TEMPERATURE_INTENSITY/);
    assert.throws(()=>temperatureTintWhitepoint(0,bad as number),/INVALID_COLOR_TEMPERATURE_INTENSITY/);
    assert.throws(()=>temperatureTintMatrix(bad as number,0),/INVALID_COLOR_TEMPERATURE_INTENSITY/);
    assert.throws(()=>temperatureTintMatrix(0,bad as number),/INVALID_COLOR_TEMPERATURE_INTENSITY/);
  }
  for(const bad of [null,{},[.5,.5],[.5,.5,.5,1],[NaN,0,0],[0,Infinity,0],[-.01,0,0],[1.01,0,0],['.5',0,0]])assert.throws(()=>applyTemperatureTint(bad as TemperatureRgb,0,0),/INVALID_COLOR_TEMPERATURE_RGB/);
  assert.equal(temperatureKelvin(-1),11976);assert.equal(temperatureKelvin(0),6500);assert.equal(temperatureKelvin(1),2776);
  assert.equal(temperatureKelvin(.5),5405.25);
});

test('neutral bypass is bit-exact and returned arrays do not share mutable state',()=>{
  const rgb:[number,number,number]=[Number.EPSILON,.435,1];
  assert.deepEqual(temperatureTintMatrix(0,0),[[1,0,0],[0,1,0],[0,0,1]]);
  assert.deepEqual(applyTemperatureTint(rgb,-0,0),rgb);
  assert.notEqual(applyTemperatureTint(rgb,0,0),rgb);
  const changed=temperatureTintMatrix(0,0) as unknown as number[][];changed[0][0]=2;
  assert.equal(temperatureTintMatrix(0,0)[0][0],1);
});

test('whitepoint and matrix agree with independent 80-digit Decimal direct transforms',()=>{
  // Decimal oracle evaluates RGB->XYZ->cone->gain->XYZ->RGB directly; it does
  // not call this module or repeat its assembled matrix multiplication.
  vectorNear(temperatureTintWhitepoint(-1,0),[.9791665003419018,1,1.6221183190126938]);
  vectorNear(temperatureTintWhitepoint(1,0),[1.1092689886959641,1,.3359062939460371]);
  const expected=[
    [1.2941588563348918,.49490893101524486,.050549712129814316],
    [-.024114069886595507,.8424679633776155,.011216997426460495],
    [-.019827571540803626,-.06062018392883479,.28299270639364665],
  ];
  temperatureTintMatrix(1,0).forEach((row,index)=>vectorNear(row,expected[index]));
  const anchors:[number,number,TemperatureRgb,TemperatureRgb][]=[
    [-1,0,[.25,.5,.75],[.15753282234544178,.5020883661750672,1]],
    [1,0,[.25,.5,.75],[.6089064636887062,.42361821228700425,.17697754494561668]],
    [0,-1,[.25,.5,.75],[.19419933386139454,.5251247240536837,.6734602815849923]],
    [0,1,[.25,.5,.75],[.30793144391090493,.4739856739608906,.8294813453636103]],
    [.5,-.5,[.3,.4,.6],[.32041030402665255,.40493227348677563,.459472346057754]],
    [-.5,.5,[.3,.4,.6],[.2900706014822095,.3915851872131207,.7429518696759061]],
    [1,1,[.5,.5,.5],[.9553753323024696,.3962479639234683,.17675613349197028]],
    [-1,-1,[.5,.5,.5],[.31329577970628036,.533745074138696,.7178764726730128]],
  ];
  for(const [temperature,tint,input,expected] of anchors)vectorNear(applyTemperatureTint(input,temperature,tint),expected);
});

test('rounded inverse and clamp position remain observable near neutral and at gamut edges',()=>{
  // A precise Bradford inverse would conceal this observed non-neutral offset.
  vectorNear(applyTemperatureTint([.5,.5,.5],1e-7,0),[.4999651190435314,.500043123452253,.49999367215016616]);
  assert.ok(Math.abs(applyTemperatureTint([.5,.5,.5],1e-7,0)[1]-.5)>4e-5);
  const warm=temperatureTintMatrix(1,0);
  assert.ok(warm[0][0]>1&&warm[1][0]<0);
  assert.deepEqual(applyTemperatureTint([0,0,0],1,1),[0,0,0]);
  assert.equal(applyTemperatureTint([1,0,0],1,0)[0],1);
  assert.equal(applyTemperatureTint([1,0,0],1,0)[1],0);
  assert.equal(applyTemperatureTint([0,0,1],-1,0)[2],1);
});

test('entire 201 by 201 normalized grid stays within locus coverage and finite gamut',()=>{
  let previousKelvin=Infinity;
  for(let ti=-100;ti<=100;ti++){
    const temperature=ti/100,kelvin=temperatureKelvin(temperature);
    assert.ok(kelvin<previousKelvin);previousKelvin=kelvin;
    for(let ji=-100;ji<=100;ji++){
      const tint=ji/100,white=temperatureTintWhitepoint(temperature,tint);
      assert.equal(white[1],1);assert.ok(white[0]>0&&white[2]>0);
      const matrix=temperatureTintMatrix(temperature,tint);
      assert.ok(matrix.flat().every(Number.isFinite));
      for(const input of [[0,0,0],[1,1,1],[.2,.5,.8]] as TemperatureRgb[])assert.ok(applyTemperatureTint(input,temperature,tint).every(value=>Number.isFinite(value)&&value>=0&&value<=1));
    }
  }
});
