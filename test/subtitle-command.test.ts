import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument} from '../packages/core/src/document.ts';
import {createSession} from '../packages/core/src/session.ts';
import type {Command} from '../packages/core/src/commands.ts';
const input='1\n00:00:00,500 --> 00:00:01,250\n第一行\n第二行\n\n2\n00:00:01,250 --> 00:00:02,000\n结束';
test('subtitle import is one revision with exact undo/redo and retained source',()=>{
 const original=emptyDocument(),session=createSession(original),command:Command={type:'subtitles.import',input,format:'srt',options:{idPrefix:'subtitle-one'}};
 const imported=session.execute(0,command);assert.equal(imported.revision,1);assert.equal(imported.document.subtitleSources?.[0].text,input);
 assert.equal(imported.document.tracks.at(-1)!.clips.length,2);
 assert.deepEqual(session.undo(1).document,original);assert.deepEqual(session.redo(2).document,imported.document);
 const before=session.snapshot();assert.throws(()=>session.execute(3,command),/SUBTITLE_ID_COLLISION/);assert.deepEqual(session.snapshot(),before);
 assert.throws(()=>session.execute(2,{...command,options:{idPrefix:'new'}}),/REVISION_CONFLICT/);assert.deepEqual(session.snapshot(),before);
 assert.throws(()=>session.execute(3,{...command,input:'bad'}),/SUBTITLE_INVALID/);assert.deepEqual(session.snapshot(),before);
});
