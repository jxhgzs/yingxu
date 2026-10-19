import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveVideoColorSpace} from '../packages/core/src/color-space.ts';

test('observed untagged SD/HD cases use explicit versioned product assumptions',()=>{
 assert.deepEqual(resolveVideoColorSpace({kind:'video',width:640,height:360}),{matrix:'smpte170m',transfer:'bt709',primaries:'smpte170m',range:'tv',assumed:true});
 assert.deepEqual(resolveVideoColorSpace({kind:'video',width:1280,height:720}),{matrix:'bt709',transfer:'bt709',primaries:'bt709',range:'tv',assumed:true});
});
test('resolution heuristic boundaries are product policy, including wide/portrait media',()=>{
 for(const [width,height,expected] of [[1279,576,'smpte170m'],[1280,576,'bt709'],[720,577,'bt709'],[1920,360,'bt709'],[360,640,'bt709']] as const)
  assert.equal(resolveVideoColorSpace({width,height}).matrix,expected);
});
test('complete supported metadata overrides dimensions and does not mutate the asset',()=>{
 const asset={kind:'video',width:1920,height:1080,colorSpace:{matrix:'bt470bg',transfer:'iec61966-2-1',primaries:'bt470bg',range:'pc'}};
 const copy=structuredClone(asset);assert.deepEqual(resolveVideoColorSpace(asset),{...asset.colorSpace,assumed:false});assert.deepEqual(asset,copy);
 assert.deepEqual(resolveVideoColorSpace({colorSpace:{matrix:'gbr',transfer:'bt709',primaries:'bt709',range:'pc'}}),{matrix:'gbr',transfer:'bt709',primaries:'bt709',range:'pc',assumed:false});
});
test('partial tags are retained field by field and missing fields remain marked assumed',()=>{
 assert.deepEqual(resolveVideoColorSpace({width:640,height:360,colorSpace:{matrix:'bt709',range:'pc'}}),{matrix:'bt709',transfer:'bt709',primaries:'smpte170m',range:'pc',assumed:true});
 assert.deepEqual(resolveVideoColorSpace({width:1920,height:1080,colorSpace:{matrix:'smpte170m',transfer:'iec61966-2-1',primaries:'smpte170m'}}),{matrix:'smpte170m',transfer:'iec61966-2-1',primaries:'smpte170m',range:'tv',assumed:true});
});
test('HDR, unknown metadata values or keys and non-video assets are explicit failures',()=>{
 for(const colorSpace of [{matrix:'bt2020nc'},{transfer:'smpte2084'},{transfer:'arib-std-b67'},{primaries:'bt2020'},{range:'unknown'},{matrix:'unknown'},{transfer:''},{matrix:null},{version:'invented'}])
  assert.throws(()=>resolveVideoColorSpace({width:1280,height:720,colorSpace:colorSpace as never}),/UNSUPPORTED_VIDEO_COLOR_SPACE/);
 for(const kind of ['image','audio','text','unknown'])assert.throws(()=>resolveVideoColorSpace({kind,width:1280,height:720}),/UNSUPPORTED_VIDEO_COLOR_SPACE/);
 for(const colorSpace of [null,[],42])assert.throws(()=>resolveVideoColorSpace({width:1280,height:720,colorSpace:colorSpace as never}),/UNSUPPORTED_VIDEO_COLOR_SPACE/);
});
test('incomplete color metadata needs valid dimensions before applying a resolution heuristic',()=>{
 for(const asset of [{},{width:1280},{width:0,height:720},{width:NaN,height:720},{width:1280,height:Infinity},{width:1280.5,height:720}])
  assert.throws(()=>resolveVideoColorSpace(asset),/UNSUPPORTED_VIDEO_COLOR_SPACE/);
});
