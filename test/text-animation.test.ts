import test from 'node:test';
import assert from 'node:assert/strict';
import {add,mul,rational,sub} from '../packages/core/src/time.ts';
import {canRenderTextAnimationText,textAnimationOpacity,textAnimationVisibleCount,validateTextAnimations,type TextAnimation} from '../packages/core/src/text-animation.ts';
const half=rational(1,2),two=rational(2);
const fadeIn:TextAnimation={phase:'in',kind:'fade',duration:half};
const fadeOut:TextAnimation={phase:'out',kind:'fade',duration:half};
const printer:TextAnimation={phase:'in',kind:'typewriter',duration:half};

test('native appear/disappear use quadOut at local target time and coexist without source clock',()=>{
  assert.equal(textAnimationOpacity([],rational(0),two),1);
  assert.equal(textAnimationOpacity(undefined,rational(0),two),1);
  const inValues=[0,.4375,.75,.9375,1];
  const outValues=[1,.5625,.25,.0625,0];
  for(let quarter=0;quarter<=4;quarter++){
    const local=rational(quarter,8);
    assert.equal(textAnimationOpacity([fadeIn],local,two),inValues[quarter]);
    assert.equal(textAnimationOpacity([fadeOut],add(rational(3,2),local),two),outValues[quarter]);
    assert.equal(textAnimationOpacity([fadeIn,fadeOut],local,two),inValues[quarter]);
    assert.equal(textAnimationOpacity([fadeIn,fadeOut],add(rational(3,2),local),two),outValues[quarter]);
  }
  assert.equal(textAnimationOpacity([fadeIn],rational(-1),two),0);
  assert.equal(textAnimationOpacity([fadeIn],rational(3),two),1);
  assert.equal(textAnimationOpacity([fadeOut],rational(-1),two),1);
  assert.equal(textAnimationOpacity([fadeOut],rational(3),two),0);
});

test('typewriter matches actual six-glyph native first-visible frames 3/5/7/9/11/13',()=>{
  const text='文字动画对照';
  const first=[3,5,7,9,11,13];
  for(let glyph=1;glyph<=6;glyph++){
    const firstFrame=first[glyph-1];
    assert.equal(textAnimationVisibleCount(printer,text,rational(firstFrame-1,30)),glyph-1);
    assert.equal(textAnimationVisibleCount(printer,text,rational(firstFrame,30)),glyph);
  }
  assert.equal(textAnimationVisibleCount(printer,text,rational(0)),0);
  assert.equal(textAnimationVisibleCount(printer,text,rational(1)),6);
  assert.equal(textAnimationOpacity([printer],rational(0),two),1);
});

test('typewriter preserves exact Floor threshold at an NTSC output boundary',()=>{
  // Choose D so the second of three glyphs reveals exactly at frame 7/30000*1001.
  const boundary=rational(7007,30000);
  const duration=mul(boundary,rational(200000,99999));
  const animation:TextAnimation={phase:'in',kind:'typewriter',duration};
  const tiny=rational(1,10n**40n);
  assert.equal(textAnimationVisibleCount(animation,'ABC',sub(boundary,tiny)),1);
  assert.equal(textAnimationVisibleCount(animation,'ABC',boundary),2);
  assert.equal(textAnimationVisibleCount(animation,'ABC',add(boundary,tiny)),2);
  assert.equal(textAnimationVisibleCount(animation,'ABC',rational(-1)),0);
});

test('unsupported glyph sequences are diagnosed instead of assuming UTF16 length is glyph count',()=>{
  for(const text of ['','A\rB','A\tB','a\u0301','👩‍💻','𠮷','\u200d','\u0000']){
    assert.equal(canRenderTextAnimationText(text),false,JSON.stringify(text));
    assert.throws(()=>textAnimationVisibleCount(printer,text,half),/GLYPHS_UNVERIFIED/);
  }
  for(const text of ['文字动画对照','ABC123!','字A','A B中文\nC'])assert.equal(canRenderTextAnimationText(text),true);
  assert.equal(textAnimationVisibleCount(fadeIn,'A B👩‍💻',half),Array.from('A B👩‍💻').length);
});

test('animation validation rejects unsupported fields, phases, duplicates and unverified overlap',()=>{
  for(const value of [[],[fadeIn],[fadeOut],[printer,fadeOut]])assert.doesNotThrow(()=>validateTextAnimations(value,two));
  const rejects:[unknown,RegExp][]=[
    [null,/INVALID_TEXT_ANIMATIONS/],[{},/INVALID_TEXT_ANIMATIONS/],[[null],/INVALID_TEXT_ANIMATION/],
    [[{...fadeIn,start:rational(0)}],/FIELD/],[[{...fadeIn,phase:'loop'}],/PHASE/],
    [[{...fadeOut,kind:'typewriter'}],/KIND/],[[{...fadeIn,kind:'slide'}],/KIND/],
    [[fadeIn,fadeIn],/DUPLICATE/],[[{...fadeIn,duration:rational(0)}],/DURATION/],
    [[{...fadeIn,duration:rational(-1)}],/DURATION/],[[{...fadeIn,duration:rational(3)}],/DURATION/],
    [[{...fadeIn,duration:{numerator:'2',denominator:'4'}}],/DURATION/],
    [[{...fadeIn,duration:{numerator:'1',denominator:'2',unit:'s'}}],/DURATION/],
    [[{...fadeIn,duration:rational(3,2)},{...fadeOut,duration:rational(1)}],/OVERLAP/],
    [[fadeIn,fadeOut,printer],/INVALID_TEXT_ANIMATIONS/],
  ];
  for(const [value,error] of rejects)assert.throws(()=>validateTextAnimations(value,two),error);
  assert.throws(()=>validateTextAnimations([],rational(0)),/CLIP_DURATION/);
  assert.doesNotThrow(()=>validateTextAnimations([fadeIn,fadeOut],rational(1)));
});


test('native mixed text counts ASCII space and LF as character-clock entries',()=>{
  const text='A B中文\nC',glyphIndices=[1,3,4,5,7],frames=[2,6,8,10,14];
  for(let i=0;i<frames.length;i++){
    assert.equal(textAnimationVisibleCount(printer,text,rational(frames[i]-1,30))<glyphIndices[i],true);
    assert.equal(textAnimationVisibleCount(printer,text,rational(frames[i],30)),glyphIndices[i]);
  }
  assert.equal(textAnimationVisibleCount(printer,text,half),7);
});
