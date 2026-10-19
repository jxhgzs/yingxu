import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDocument,defaultTransform} from '../packages/core/src/document.ts';
import {rational,frameTime} from '../packages/core/src/time.ts';
import {createPreviewPlan,previewFrame,sourceSeekTime,transitionWeights} from '../apps/editor/src/preview/plan.ts';

function fixture(){
 const doc=emptyDocument();doc.fps=rational(30);doc.canvas={width:320,height:180};
 doc.assets.push({id:'v',kind:'video',path:'/not-read.mp4',duration:rational(10),width:320,height:180,hasAudio:true,fps:rational(30)});
 const outgoing={id:'out',materialId:'v',source:{start:rational(1),duration:rational(3)},target:{start:rational(0),duration:rational(3)},speed:rational(1),editableTiming:true,transform:defaultTransform()};
 const incoming={...structuredClone(outgoing),id:'in',source:{start:rational(2),duration:rational(3)},target:{start:rational(3),duration:rational(3)}};
 doc.tracks[0].clips.push(outgoing,incoming);doc.transitions=[{id:'dissolve',trackId:doc.tracks[0].id,outgoingClipId:'out',incomingClipId:'in',kind:'crossfade',alignment:'center',overlap:true,duration:rational(1)}];
 return doc;
}
test('center crossfade decodes handles, keeps duration and leaves audio at the original cut',()=>{
 const doc=fixture(),result=createPreviewPlan(doc);assert.equal(result.support.supported,true);const plan=result.plan!;assert.equal(plan.duration,6);assert.equal(result.support.maxConcurrentMedia,2);
 const before=previewFrame(plan,rational(12,5));assert.equal(before.layers[0].clip.id,'out');assert.equal(before.media.length,1);
 const quarter=previewFrame(plan,rational(41,15));assert.equal(quarter.layers.length,1);assert.equal(quarter.media.length,2);assert.equal(quarter.audio[0].clip.id,'out');
 const pair=quarter.layers[0].transition!;assert(pair);assert.equal(pair.id,'dissolve');assert(Math.abs(pair.progress-7/30)<1e-12);assert.equal(pair.incoming.clip.id,'in');assert.deepEqual(pair.incoming.sourceTime,rational(26,15));
 const afterCut=previewFrame(plan,rational(16,5));assert.deepEqual(afterCut.layers[0].sourceTime,rational(21,5));assert.equal(afterCut.audio[0].clip.id,'in');
 assert(sourceSeekTime(doc.tracks[0].clips[0],doc.assets[0],rational(16,5),doc.fps)>4,'outgoing decoder clamped its handle');
 assert(sourceSeekTime(doc.tracks[0].clips[1],doc.assets[0],rational(41,15),doc.fps)<2,'incoming decoder clamped its handle');
 const end=previewFrame(plan,rational(7,2));assert.equal(end.layers[0].clip.id,'in');assert.equal(end.layers[0].transition,undefined);assert.equal(end.media.length,1);
});
test('transition substitutes its track slot without shifting lower or upper layers',()=>{
 const doc=fixture(),extra=(id:string)=>({...structuredClone(doc.tracks[0].clips[0]),id,target:{start:rational(0),duration:rational(6)},source:{start:rational(0),duration:rational(6)}});
 doc.tracks.unshift({...structuredClone(doc.tracks[0]),id:'lower',clips:[extra('lower')]});doc.tracks.push({...structuredClone(doc.tracks[1]),id:'upper',clips:[extra('upper')]});
 const frame=previewFrame(createPreviewPlan(doc).plan!,rational(3));assert.deepEqual(frame.layers.map(l=>l.clip.id),['lower','out','upper']);assert.equal(frame.layers[1].transition?.progress,.5);
 doc.tracks.find(t=>t.id===doc.transitions![0].trackId)!.hidden=true;
 const hidden=previewFrame(createPreviewPlan(doc).plan!,rational(3));assert.deepEqual(hidden.layers.map(l=>l.clip.id),['lower','upper']);
});
test('NTSC crossfade has exact half-open output boundaries and refuses unknown extra semantics',()=>{
 const doc=fixture();doc.fps=rational(30000,1001);const plan=createPreviewPlan(doc).plan!;
 assert.equal(previewFrame(plan,frameTime(74,doc.fps)).layers[0].transition,undefined);
 assert(Math.abs(previewFrame(plan,frameTime(75,doc.fps)).layers[0].transition!.progress-.0025)<1e-12);
 assert(previewFrame(plan,frameTime(104,doc.fps)).layers[0].transition);
 assert.equal(previewFrame(plan,frameTime(105,doc.fps)).layers[0].transition,undefined);
 Object.assign(doc.transitions![0],{unparsedBlendMode:'screen'});assert(createPreviewPlan(doc).support.reasons.some(r=>r.code==='INVALID_PREVIEW_DOCUMENT'&&r.message.includes('UNSUPPORTED_TRANSITION_FIELD')));
});
test('dip to opaque black uses no source handles and does not reveal the lower layer at midpoint',()=>{
 const doc=fixture();Object.assign(doc.transitions![0],{kind:'dipToBlack',overlap:false});doc.assets[0].duration=rational(3);
 for(const clip of doc.tracks[0].clips)clip.source={start:rational(0),duration:rational(3)};
 const result=createPreviewPlan(doc);assert(result.support.supported);assert.equal(result.support.maxConcurrentMedia,1);
 const before=previewFrame(result.plan!,rational(41,15));assert.equal(before.media.length,1);assert.equal(before.media[0].clip.id,'out');assert.deepEqual(before.layers[0].transition!.incoming.sourceTime,rational(0));
 const after=previewFrame(result.plan!,rational(16,5));assert.equal(after.media.length,1);assert.equal(after.media[0].clip.id,'in');assert.deepEqual(after.layers[0].sourceTime,rational(3));assert.equal(after.layers[0].transition?.kind,'dipToBlack');
 const composite=(p:number)=>{const [out,incoming,black]=transitionWeights('dipToBlack',p),alpha=.5*out+.5*incoming+black;return [.5*out,1-alpha,.5*incoming];};
 assert.deepEqual(composite(0),[.5,.5,0]);assert.deepEqual(composite(.25),[.25,.25,0]);assert.deepEqual(composite(.5),[0,0,0]);assert.deepEqual(composite(.75),[0,.25,.25]);assert.deepEqual(composite(1),[0,.5,.5]);
 assert.deepEqual(transitionWeights('crossfade',.5),[.5,.5,0]);
});
