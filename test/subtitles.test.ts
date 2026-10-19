import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSubtitles,SubtitleParseError} from '../packages/core/src/subtitles.ts';
import {applySubtitleImport} from '../packages/core/src/subtitle-import.ts';
import {emptyDocument,validateDocument} from '../packages/core/src/document.ts';
import {rational,ZERO} from '../packages/core/src/time.ts';
import {createSession} from '../packages/core/src/session.ts';
import fs from 'node:fs';

test('SRT preserves Chinese/multiline and exact millisecond times beyond 99 hours',()=>{
  const source='\uFEFF1\r\n100:01:02,001 --> 100:01:03,005\r\n 中文  \r\n第二行 {\\pos(1,2)}\r\n\r\n002\r\n100:01:03,005 --> 100:01:04,000\r\n结束\r\n';
  const result=parseSubtitles(source,'srt');
  assert.equal(result.sourceText,source);
  assert.equal(result.cues[0].text,' 中文  \n第二行 {\\pos(1,2)}');
  assert.deepEqual(result.cues[0].start,rational(360062001,1000));
  assert.deepEqual(result.cues[0].duration,rational(251,250));
  assert.equal(result.cues[1].id,'002');
  assert(result.diagnostics.some(d=>d.code==='SUBTITLE_ASS_MARKUP_LITERAL'));
});
test('WebVTT supports identifiers, minute timestamps and escaped text with explicit diagnostics',()=>{
  const parsed=parseSubtitles('WEBVTT 示例\n\nNOTE author metadata\nnot displayed\n\ncue一\n00:01.001 --> 00:03.010\n<v 旁白><b>你好</b> &amp; &lt;世界&gt;\n第二行\n','vtt');
  assert.equal(parsed.cues[0].text,'你好 & <世界>\n第二行');
  assert.deepEqual(parsed.cues[0].start,rational(1001,1000));
  assert.deepEqual(parsed.cues[0].duration,rational(2009,1000));
  assert.equal(parsed.cues[0].id,'cue一');
  assert(parsed.diagnostics.some(d=>d.code==='SUBTITLE_FORMATTING_REMOVED'&&d.severity==='warning'));
  assert(parsed.diagnostics.some(d=>d.code==='SUBTITLE_NOTE_IGNORED'));
});
test('subtitle parsing rejects malformed/unsupported semantics without a partial result',()=>{
  for(const source of ['1\n-00:00:01,000 --> 00:00:02,000\na','1\n00:00:02,000 --> 00:00:01,000\na','1\n00:00:01,000 --> 00:00:01,000\na','1\n00:60:01,000 --> 01:00:02,000\na','1\n00:00:01,000 --> 00:00:02,000\n','1\n00:00:01,000 --> 00:00:02,000\na\u0000b'])assert.throws(()=>parseSubtitles(source,'srt'),SubtitleParseError);
  for(const block of ['00:01.000 --> 00:02.000 align:start\na','STYLE\n::cue {color: red}','REGION\nid:main','00:01.000 --> 00:02.000\n<ruby>字<rt>zi</rt></ruby>','00:01.000 --> 00:02.000\na<00:01.500>b','00:01.000 --> 00:02.000\n<img src=x>'])assert.throws(()=>parseSubtitles('WEBVTT\n\n'+block,'vtt'),SubtitleParseError);
  assert.throws(()=>parseSubtitles('00:01.000 --> 00:02.000\na','vtt'),/SUBTITLE_INVALID_HEADER/);
  assert.throws(()=>parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n'+ 'x'.repeat(2001),'srt'),/SUBTITLE_TEXT_LIMIT/);
  assert.throws(()=>parseSubtitles('x'.repeat(4*1024*1024+1),'srt'),/SUBTITLE_FILE_LIMIT/);
});
test('subtitle import is atomic, precise and allocates separate visible overlap lanes',()=>{
  const doc=emptyDocument(),before=structuredClone(doc),parsed=parseSubtitles('1\n00:00:00,001 --> 00:00:02,001\n甲\n\n2\n00:00:01,000 --> 00:00:03,000\n乙\n\n3\n00:00:02,001 --> 00:00:04,000\n丙','srt');
  const result=applySubtitleImport(doc,parsed,{idPrefix:'sub-test',offset:rational(1,3),name:'导入字幕'});
  assert.deepEqual(doc,before);validateDocument(result.document);
  assert.deepEqual(result.document.subtitleSources,[{id:'sub-test-source',assetId:'sub-test-asset',name:'导入字幕',format:'srt',text:parsed.sourceText}]);
  assert.equal(result.trackIds.length,2);assert.equal(result.clipIds.length,3);
  assert.deepEqual(result.document.tracks[3].clips[0].target.start,rational(1003,3000));
  assert.equal(result.document.tracks[3].clips.length,2);
  assert(result.document.tracks[3].clips[0].transform!.y>result.document.tracks[4].clips[0].transform!.y);
  assert.deepEqual(result.document.tracks[3].clips[0].source.start,ZERO);
  assert.throws(()=>applySubtitleImport(result.document,parsed,{idPrefix:'sub-test'}),/SUBTITLE_ID_COLLISION/);
  assert.throws(()=>applySubtitleImport(doc,parsed,{idPrefix:'bad',offset:rational(-1)}),/SUBTITLE_NEGATIVE_START/);
  assert.deepEqual(doc,before);
});
test('subtitle import enforces layout/track limits and validates forged parsed structures',()=>{
  const doc=emptyDocument(),single=parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n一','srt');
  assert.throws(()=>applySubtitleImport(doc,single,{idPrefix:'q',style:{font:'x\\y'}}),/INVALID_FONT/);
  const overlap=parseSubtitles(Array.from({length:30},(_,i)=>`${i+1}\n00:00:00,000 --> 00:00:01,000\n字幕`).join('\n\n'),'srt');
  assert.throws(()=>applySubtitleImport(doc,overlap,{idPrefix:'q'}),/SUBTITLE_LAYOUT_OVERFLOW/);
  const full=emptyDocument();full.tracks=Array.from({length:500},(_,i)=>({id:'t'+i,kind:'text',clips:[]}));
  assert.throws(()=>applySubtitleImport(full,single,{idPrefix:'q'}),/SUBTITLE_TRACK_LIMIT/);
  const forged=structuredClone(single);forged.cues[0].duration=rational(-1);
  assert.throws(()=>applySubtitleImport(doc,forged,{idPrefix:'q'}),/SUBTITLE_INVALID_CUE/);
});
test('5000 cues import with one asset and exact contiguous boundaries',()=>{
  const stamp=(n:number)=>`${String(Math.floor(n/3600)).padStart(2,'0')}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')},000`;
  const input=Array.from({length:5000},(_,i)=>`${i+1}\n${stamp(i)} --> ${stamp(i+1)}\n字幕${i}`).join('\n\n'),parsed=parseSubtitles(input,'srt');
  const result=applySubtitleImport(emptyDocument(),parsed,{idPrefix:'long'});
  assert.equal(result.document.assets.length,1);assert.equal(result.trackIds.length,1);assert.equal(result.clipIds.length,5000);
  assert.deepEqual(result.document.tracks.at(-1)!.clips.at(-1)!.target.start,rational(4999));
  assert.throws(()=>parseSubtitles(input+'\n\n5001\n02:00:00,000 --> 02:00:01,000\n多余','srt'),/SUBTITLE_CUE_LIMIT/);
});

test('SRT markup, entities and scripts remain literal strings while VTT keeps explicit conversion',()=>{
  const escaped=parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n&lt;script&gt;alert(1)&lt;/script&gt; &#x4e2d;','srt');
  assert.equal(escaped.cues[0].text,'&lt;script&gt;alert(1)&lt;/script&gt; &#x4e2d;');
  const styled=parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n<FONT color="red"><I>中文</I></FONT>','srt');
  assert.equal(styled.cues[0].text,'<FONT color="red"><I>中文</I></FONT>');assert.deepEqual(styled.diagnostics,[]);
  assert.equal(parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n&#0; &unknown; <script>alert(1)</script>','srt').cues[0].text,'&#0; &unknown; <script>alert(1)</script>');
  assert.throws(()=>parseSubtitles('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0\n\n00:01.000 --> 00:02.000\n一','vtt'),/SUBTITLE_UNSUPPORTED_HEADER/);
  assert.throws(()=>parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n甲\n00:00:01,000 --> 00:00:02,000\n乙','srt'),/SUBTITLE_MISSING_SEPARATOR/);
});

test('subtitle source text follows atomic history, download serialization and restore',()=>{
 const input='\uFEFF1\r\n00:00:00,001 --> 00:00:02,001\r\n<b>字幕</b>\r\n';
 const doc=emptyDocument(),session=createSession(doc);
 const first=session.execute(0,{type:'subtitles.import',input,format:'srt',options:{idPrefix:'history'}});
 assert.equal(first.revision,1);assert.equal(first.document.subtitleSources?.[0].text,input);
 assert.deepEqual(session.undo(1).document,doc);
 assert.equal(session.redo(2).document.subtitleSources?.[0].text,input);
 const archive=JSON.parse(JSON.stringify(session.serialize())),restored=createSession(archive.document,archive);
 assert.equal(restored.snapshot().document.subtitleSources?.[0].text,input);
 assert.deepEqual(restored.undo(3).document,doc);
 const colliding=structuredClone(first.document);colliding.subtitleSources![0].id='other-source';
 assert.throws(()=>applySubtitleImport(colliding,parseSubtitles(input,'srt'),{idPrefix:'other'}),/SUBTITLE_ID_COLLISION/);
});

test('SRT visible arrows and numeric carriage return entities remain literal',()=>{
 const arrows=parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n左 --> 右\n因果 A-->B','srt');
 assert.equal(arrows.cues[0].text,'左 --> 右\n因果 A-->B');
 const cr=parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n甲&#13;乙&#13;&#10;丙','srt');
 assert.equal(cr.cues[0].text,'甲&#13;乙&#13;&#10;丙');
});

test('native 5.9.0 SRT fixtures retain literal text, exact times and default overlap coordinates',()=>{
 const sample=fs.readFileSync(new URL('../evidence/2026-10-19-subtitles/source-sample.srt',import.meta.url),'utf8');
 const parsed=parseSubtitles(sample,'srt');assert.equal(parsed.sourceText,sample);
 assert.deepEqual(parsed.cues.map(c=>c.text),['第一条字幕','中文与 English\n两行保持换行','<b>样式将转为普通文字</b>','重叠字幕独立分层']);
 assert.deepEqual(parsed.cues.map(c=>c.start),[rational(1,2),rational(3,2),rational(5,2),rational(3)]);
 assert.deepEqual(parsed.diagnostics,[]);
 const d=emptyDocument();d.canvas={width:1280,height:720};
 const result=applySubtitleImport(d,parsed,{idPrefix:'native-fixture'}),first=result.document.tracks[3],second=result.document.tracks[4];
 assert.equal(first.clips.length,3);assert.equal(second.clips.length,1);
 assert.deepEqual(first.clips.map(c=>c.transform!.y),[288,288,288]);assert.equal(second.clips[0].transform!.y,216);
 assert(first.clips.every(c=>c.text!.size===36*1.412&&c.text!.font==='Source Han Sans SC Medium'&&c.text!.lineHeight===38&&c.text!.outline===0&&c.text!.shadow===0));
 const literal=fs.readFileSync(new URL('../evidence/2026-10-19-subtitles/source-literal.srt',import.meta.url),'utf8');
 const entities=parseSubtitles(literal,'srt');assert.equal(entities.cues[0].text,'&lt;中文&gt; &amp; &#13; <i>斜体</i> <script>x</script>');
 assert.deepEqual(entities.cues[0].start,rational(9,2));assert.deepEqual(entities.cues[0].duration,rational(1));assert.deepEqual(entities.diagnostics,[]);
});

test('SRT lane steps stay at 0.1H regardless of other cue line counts and reused lanes validate their own height',()=>{
 const d=emptyDocument();d.canvas={width:1280,height:720};
 const parsed=parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n先前\n两行\n\n2\n00:00:02,000 --> 00:00:04,000\n主层\n\n3\n00:00:03,000 --> 00:00:04,000\n重叠','srt');
 const result=applySubtitleImport(d,parsed,{idPrefix:'lanes'});
 assert.deepEqual(result.document.tracks[3].clips.map(c=>c.transform!.y),[288,288]);assert.equal(result.document.tracks[4].clips[0].transform!.y,216);
 const tooTall=parseSubtitles('1\n00:00:00,000 --> 00:00:01,000\n首条\n\n2\n00:00:02,000 --> 00:00:03,000\n一\n二\n三\n四','srt');
 assert.throws(()=>applySubtitleImport(d,tooTall,{idPrefix:'tall'}),/SUBTITLE_LAYOUT_OVERFLOW/);
});
