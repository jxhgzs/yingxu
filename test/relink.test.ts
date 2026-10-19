import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAssetRelink} from '../packages/core/src/relink.ts';
import {emptyDocument,validateDocument,defaultTransform} from '../packages/core/src/document.ts';
import type {Asset,Document} from '../packages/core/src/document.ts';
import {rational} from '../packages/core/src/time.ts';
const replacement:Asset={id:'registered',path:'/trusted/upload.mp4',name:'新素材',kind:'video',duration:rational(12),width:1920,height:1080,hasAudio:true,fps:rational(30),sha256:'b'.repeat(64),mime:'video/mp4'};
function fixture():Document{
 const doc=emptyDocument();doc.assets=[{id:'missing',path:'/missing/draft.mp4',kind:'video',name:'旧素材',duration:rational(10),sha256:'a'.repeat(64)}];
 doc.tracks[0].clips=[{id:'clip-1',materialId:'missing',source:{start:rational(1,3),duration:rational(7,3)},target:{start:rational(0),duration:rational(7,3)},speed:rational(1),editableTiming:true,transform:{...defaultTransform(),scale:1.2},animations:[{property:'scale',points:[{id:'point',time:rational(2),value:1.3,interpolation:'linear'}]}]}];
 doc.tracks.push({id:'overlay',kind:'video',clips:[{id:'clip-2',materialId:'missing',source:{start:rational(5),duration:rational(4)},target:{start:rational(3),duration:rational(2)},speed:rational(2),editableTiming:true,volume:.8}]});return doc;
}
test('asset relink rewrites all references atomically and preserves timing, transform and curves',()=>{
 const doc=fixture(),before=structuredClone(doc),next=applyAssetRelink(doc,{assetId:'missing',replacement});
 assert.deepEqual(doc,before);validateDocument(next);
 assert.equal(next.assets.length,1);assert.deepEqual(next.assets[0],replacement);
 for(const track of next.tracks)for(const clip of track.clips){assert.equal(clip.materialId,replacement.id);const original=before.tracks.flatMap(t=>t.clips).find(c=>c.id===clip.id)!;assert.deepEqual({...clip,materialId:'missing'},original);}
 next.assets[0].name='mutated';assert.equal(replacement.name,'新素材');assert.deepEqual(doc,before);
});
test('asset relink reuses existing identical registered identity and rejects metadata conflicts',()=>{
 const doc=fixture();doc.assets.push({...replacement,name:'工程自己的标签'});
 const next=applyAssetRelink(doc,{assetId:'missing',replacement});
 assert.equal(next.assets.length,1);assert.equal(next.assets[0].name,'工程自己的标签');
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,path:'/other/path'}}),/RELINK_ID_CONFLICT/);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,sha256:'c'.repeat(64)}}),/RELINK_ID_CONFLICT/);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,duration:rational(99)}}),/RELINK_ID_CONFLICT/);
 const same=applyAssetRelink(next,{assetId:'registered',replacement});assert.deepEqual(same,next);
});
test('asset relink rejects missing/text/type mismatch and every unsafe timing or locked reference without mutation',()=>{
 const doc=fixture(),before=structuredClone(doc);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'no-such-asset',replacement}),/RELINK_ASSET_NOT_FOUND/);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,kind:'text'}}),/RELINK_TEXT_UNSUPPORTED/);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,kind:'audio'}}),/RELINK_KIND_MISMATCH/);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,duration:rational(8)}}),/SOURCE_RANGE_EXCEEDED/);
 doc.tracks[3].locked=true;assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement}),/TRACK_LOCKED/);delete doc.tracks[3].locked;
 doc.tracks[3].clips[0].editableTiming=false;assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement}),/TIMING_NOT_INTERPRETED/);doc.tracks[3].clips[0].editableTiming=true;
 assert.deepEqual(doc,before);
 const textDoc=emptyDocument();textDoc.assets=[{id:'text',path:'',kind:'text',duration:rational(1)}];assert.throws(()=>applyAssetRelink(textDoc,{assetId:'text',replacement}),/RELINK_TEXT_UNSUPPORTED/);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,duration:rational(0)}}),/INVALID_TIME/);
});
test('video/image replacements preserve video-track semantics, audio remains audio and unreferenced assets are replaced',()=>{
 const doc=fixture(),image={...replacement,id:'image',kind:'image' as const,hasAudio:false,mime:'image/png'};
 const next=applyAssetRelink(doc,{assetId:'missing',replacement:image});validateDocument(next);assert.equal(next.assets[0].kind,'image');
 const audio=emptyDocument();audio.assets=[{id:'a',path:'/old.wav',kind:'audio',duration:rational(2)}];audio.tracks[1].clips=[{id:'ac',materialId:'a',source:{start:rational(0),duration:rational(2)},target:{start:rational(0),duration:rational(2)},speed:rational(1),editableTiming:true}];
 assert.equal(applyAssetRelink(audio,{assetId:'a',replacement:{...replacement,kind:'audio'}}).tracks[1].clips[0].materialId,'registered');
 assert.throws(()=>applyAssetRelink(audio,{assetId:'a',replacement}),/RELINK_KIND_MISMATCH/);
 const unused=emptyDocument();unused.assets=[{id:'old',path:'/unknown',duration:rational(1)}];assert.deepEqual(applyAssetRelink(unused,{assetId:'old',replacement}).assets,[replacement]);
});
test('relink keeps original data if new duration excludes an off-clip source-clock keyframe',()=>{
 const doc=fixture();doc.tracks[3].clips=[];doc.tracks[0].clips[0].animations![0].points.push({id:'outside',time:rational(10),value:1.4,interpolation:'linear'});
 const before=structuredClone(doc);
 assert.throws(()=>applyAssetRelink(doc,{assetId:'missing',replacement:{...replacement,duration:rational(3)}}),/KEYFRAME_OUTSIDE_MATERIAL/);
 assert.deepEqual(doc,before);
});
