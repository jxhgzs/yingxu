import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {ffmpeg} from '../packages/media/src/probe.ts';
import {applyColorAdjustments} from '../packages/core/src/color-effects.ts';
import type {ColorAdjustments,RGB} from '../packages/core/src/color-effects.ts';
import {colorEffectsGeq,colorEffectsGeqExpressions,colorEffectsShader} from '../packages/media/src/color-effects.ts';
const adjust=(fields:Omit<ColorAdjustments,'version'>):ColorAdjustments=>({version:'combine-adjust-v2',...fields});

test('actual FFmpeg geq planar RGB expressions agree with CPU stages and preserve alpha',()=>{
  const input=Buffer.alloc(16*4*4);
  for(let pixel=0;pixel<64;pixel++){
    // GBRAP raw plane order is green, blue, red, alpha. Avoid packed conversion:
    // this FFmpeg build changes alpha128 to129 on a plain RGBA/GBRAP round trip.
    input[pixel]=(Math.floor(pixel/4)%4)*85;input[64+pixel]=Math.floor(pixel/16)*85;input[128+pixel]=(pixel%4)*85;input[192+pixel]=pixel*4;
  }
  for(const [pixel,rgb] of ([[0,0,0],[255,255,255],[128,128,128],[127,127,127],[1,1,1],[254,254,254],[128,64,192],[5,19,239]] as const).entries()){
    input[128+pixel]=rgb[0];input[pixel]=rgb[1];input[64+pixel]=rgb[2];
  }
  input[255]=255;
  const cases=[undefined,adjust({brightness:-1}),adjust({brightness:.5}),adjust({brightness:.7}),adjust({contrast:-1}),adjust({contrast:-.5}),adjust({contrast:.5}),adjust({contrast:1}),adjust({contrast:.00002}),adjust({saturation:-1}),adjust({saturation:.5}),adjust({highlight:.5}),adjust({shadow:-.5}),adjust({brightness:.3,contrast:.5,saturation:.7,highlight:-.3,shadow:.6}),adjust({brightness:-.8,contrast:-1,saturation:.7,highlight:.3,shadow:-.6})];
  for(const value of cases){
    const result=spawnSync(ffmpeg(),['-v','error','-threads','1','-filter_threads','1','-f','rawvideo','-pixel_format','gbrap','-video_size','16x4','-i','pipe:0','-frames:v','1','-vf',colorEffectsGeq(value)??'null','-pix_fmt','gbrap','-f','rawvideo','pipe:1'],{input,maxBuffer:1024*1024,timeout:20000});
    assert.equal(result.status,0,result.stderr?.toString());assert.equal(result.stdout.length,input.length);
    for(let pixel=0;pixel<64;pixel++){
      const rgb:RGB=[input[128+pixel]/255,input[pixel]/255,input[64+pixel]/255],cpu=applyColorAdjustments(rgb,value);
      const planeOffsets=[128,0,64];
      for(let channel=0;channel<3;channel++)assert.ok(Math.abs(result.stdout[planeOffsets[channel]+pixel]-cpu[channel]*255)<=1.000001,`${JSON.stringify(value)} pixel ${pixel} channel ${channel}: ${result.stdout[planeOffsets[channel]+pixel]} vs ${cpu[channel]*255}`);
      assert.equal(result.stdout[192+pixel],input[192+pixel]);
    }
  }
});

test('neutral compilers avoid rendering work and generated names reject shader injection',()=>{
  assert.equal(colorEffectsGeq(),undefined);assert.equal(colorEffectsGeq(adjust({brightness:1e-5})),undefined);
  assert.deepEqual(colorEffectsGeqExpressions(),{r:'r(X,Y)',g:'g(X,Y)',b:'b(X,Y)',a:'alpha(X,Y)'});
  assert.equal(colorEffectsShader(),['vec3 applyColorAdjustments(vec3 inputColor) {','  vec3 adjusted = inputColor;','  return adjusted;','}'].join('\n'));
  assert.throws(()=>colorEffectsShader(undefined,'main'),/INVALID_COLOR_SHADER_NAME/);
  assert.throws(()=>colorEffectsShader(undefined,'gl_FragColor'),/INVALID_COLOR_SHADER_NAME/);
  assert.throws(()=>colorEffectsShader(undefined,'x);discard;'),/INVALID_COLOR_SHADER_NAME/);
  for(const value of [{version:'other'},{version:'combine-adjust-v2',unknown:.1},{version:'combine-adjust-v2',shadow:NaN}]){
    assert.throws(()=>colorEffectsGeq(value as ColorAdjustments),/INVALID_COLOR_ADJUSTMENTS/);
    assert.throws(()=>colorEffectsShader(value as ColorAdjustments),/INVALID_COLOR_ADJUSTMENTS/);
  }
});

test('GLSL generation uses the common fixed stage order and clamps every active step',()=>{
  const shader=colorEffectsShader(adjust({brightness:.5,contrast:.5,saturation:-.5,highlight:.2,shadow:-.3}),'editorColor');
  assert.ok(shader.startsWith('vec3 editorColor(vec3 inputColor)'));
  assert.equal((shader.match(/adjusted = clamp/g)||[]).length,5);
  assert.ok(shader.indexOf('vec3(1.75)')<shader.indexOf('vec3 fxContrastSigmoid'));
  assert.ok(shader.indexOf('vec3 fxContrastSigmoid')<shader.indexOf('float fxLuma'));
  assert.ok(shader.indexOf('float fxLuma')<shader.indexOf('vec3 fxHighlightInput'));
  assert.ok(shader.indexOf('vec3 fxHighlightInput')<shader.indexOf('vec3 fxShadowInput'));
  assert.ok(!shader.includes('texture')&&!shader.includes('uniform'));
});
