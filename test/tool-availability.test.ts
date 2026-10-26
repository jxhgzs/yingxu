import test from 'node:test';import assert from 'node:assert/strict';
import {emptyDocument} from '../packages/core/src/document.ts';import {rational as r} from '../packages/core/src/time.ts';
import {timelineToolReasons,validateMediaTool,createTimelineToolResolver} from '../packages/core/src/tool-availability.ts';
function fixture(){const d=emptyDocument();d.canvas={width:1280,height:720};d.assets=[{id:'a',path:'/fixture',kind:'video',width:1280,height:720,duration:r(9),fps:r(30),frameTiming:'cfr30',pixelFormat:'yuv420p',verifiedDisplayTransform:'identity'}];d.tracks[0].clips=[{id:'c',materialId:'a',source:{start:r(0),duration:r(3)},target:{start:r(0),duration:r(3)},speed:r(1),editableTiming:true},{id:'b',materialId:'a',source:{start:r(3),duration:r(3)},target:{start:r(3),duration:r(3)},speed:r(1),editableTiming:true}];return d;}
const proof={reason:'',fileReason:'',frames:270};
test('ten tool states reflect selection, head boundaries, type, lock, unknown timing and global guards',()=>{
 const d=fixture(),reason=(at=r(1),id:string|null='c')=>timelineToolReasons(d,id,at,proof);
 assert(Object.values(reason()).every(v=>v===''),JSON.stringify(reason()));
 const none=reason(r(1),null);assert.equal(none.marker,'');assert.equal(none.freeze,'TOOL_SELECT_CLIP');
 assert.match(reason(r(0)).split,/SPLIT_OUTSIDE/);assert.equal(reason(r(0)).freeze,'');assert.match(reason(r(3)).freeze,/FREEZE_OUTSIDE/);
 d.tracks[0].locked=true;assert(Object.values(reason()).every(v=>v==='TRACK_LOCKED'));assert.equal(reason(r(8)).marker,'');d.tracks[0].locked=false;
 d.tracks[0].clips[0].editableTiming=false;assert(Object.values(reason()).every(v=>v==='TIMING_NOT_INTERPRETED'));d.tracks[0].clips[0].editableTiming=true;
 for(const blocked of ['TOOL_BUSY','TOOL_READ_ONLY','TOOL_LOADING'])assert(Object.values(timelineToolReasons(d,'c',r(1),proof,blocked)).every(v=>v===blocked));
 assert(Object.values(timelineToolReasons(undefined,null,r(0))).every(v=>v==='TOOL_NO_PROJECT'));
 for(const kind of ['audio','text','image'] as const){const x=fixture();x.assets[0].kind=kind;delete x.assets[0].frameTiming;delete x.assets[0].pixelFormat;const s=timelineToolReasons(x,'c',r(1),proof);assert.match(s.freeze,/MEDIA_OPERATION_UNSUPPORTED/);assert.match(s.reverse,/MEDIA_OPERATION_UNSUPPORTED/);assert.equal(s.crop,kind==='image'?'':'TOOL_SELECT_VISUAL');}
});
test('preflight follows actual downstream transition, marker, orientation, rotation and batch restrictions',()=>{
 const d=fixture();d.tracks[0].clips.push({...structuredClone(d.tracks[0].clips[1]),id:'last',target:{start:r(6),duration:r(3)}});d.transitions=[{id:'t',trackId:d.tracks[0].id,alignment:'center',overlap:true,kind:'crossfade',outgoingClipId:'b',incomingClipId:'last',duration:r(1,2)}];
 let s=timelineToolReasons(d,'c',r(1),proof);assert.equal(s.split,'');assert.match(s.cutLeft,/TRANSITION_EDIT_REQUIRES_REMOVAL|TRANSITION_PAIR_NOT_ADJACENT/);assert.match(s.cutRight,/TRANSITION_EDIT_REQUIRES_REMOVAL|TRANSITION_PAIR_NOT_ADJACENT/);assert.match(s.freeze,/TRANSITION_EDIT_REQUIRES_REMOVAL|TRANSITION_PAIR_NOT_ADJACENT/);delete d.transitions;
 d.tracks[0].clips[0].markers=[{id:'m',time:r(1),title:'M',color:'#00c1cd'}];assert.equal(timelineToolReasons(d,'c',r(1),proof).marker,'TOOL_MARKER_EXISTS');
 d.assets[0].verifiedDisplayTransform='unsupported';s=timelineToolReasons(d,'c',r(1),proof);assert.equal(s.freeze,'MEDIA_OPERATION_UNSUPPORTED');assert.equal(s.crop,'MEDIA_OPERATION_UNSUPPORTED');d.assets[0].verifiedDisplayTransform='identity';
 d.tracks[0].clips[0].animations=[{property:'rotation',points:[{id:'p',time:r(0),value:0,interpolation:'linear'}]}];assert.equal(timelineToolReasons(d,'c',r(5),proof).rotate,'TOOL_ANIMATED_ROTATION_OUTSIDE');
 const large=fixture();large.assets[0].duration=r(500);for(let i=2;i<102;i++)large.tracks[0].clips.push({...structuredClone(large.tracks[0].clips[1]),id:'later'+i,target:{start:r(i*3),duration:r(3)}});assert.equal(timelineToolReasons(large,'c',r(1),proof).cutLeft,'INVALID_COMMAND_BATCH');assert.equal(timelineToolReasons(large,'c',r(1),proof).freeze,'INVALID_COMMAND_BATCH');
});
test('media proof gates freeze/reverse but does not disable valid VFR cropping',()=>{
 const d=fixture();let s=timelineToolReasons(d,'c',r(1));assert.equal(s.freeze,'MEDIA_TOOL_CHECKING');assert.equal(s.crop,'MEDIA_TOOL_CHECKING');
 s=timelineToolReasons(d,'c',r(1),{reason:'MEDIA_OPERATION_FRAME_TIMING',fileReason:''});assert.equal(s.reverse,'MEDIA_OPERATION_FRAME_TIMING');assert.equal(s.crop,'');
 s=timelineToolReasons(d,'c',r(1),{reason:'MEDIA_SOURCE_MISSING',fileReason:'MEDIA_SOURCE_MISSING'});assert.equal(s.freeze,'MEDIA_SOURCE_MISSING');assert.equal(s.crop,'MEDIA_SOURCE_MISSING');
 d.assets[0].fps=r(240);assert.throws(()=>validateMediaTool(d,'reverse',{clipId:'c'}),/REVERSE_MEDIA_LIMIT/);assert.equal(timelineToolReasons(d,'c',r(1),proof).reverse,'REVERSE_MEDIA_LIMIT');
});

test('immutable toolbar resolver keeps head-sensitive markers, boundaries and frame limits current after cache reuse',()=>{
 const resolve=createTimelineToolResolver(),d=fixture();d.tracks[0].clips[0].markers=[{id:'m',time:r(2),title:'M',color:'#00c1cd'}];
 assert.equal(resolve(d,'c',r(1),proof).marker,'');assert.equal(resolve(d,'c',r(2),proof).marker,'TOOL_MARKER_EXISTS');assert.match(resolve(d,'c',r(0),proof).split,/SPLIT_OUTSIDE/);
 assert.equal(resolve(d,'c',r(1),{reason:'',frames:45}).freeze,'');assert.equal(resolve(d,'c',r(2),{reason:'',frames:45}).freeze,'FREEZE_OUTSIDE_CLIP');
 const locked=structuredClone(d);locked.tracks[0].locked=true;assert.equal(resolve(locked,'c',r(1),proof).marker,'TRACK_LOCKED');assert.equal(resolve(locked,'c',r(1),proof).reverse,'TRACK_LOCKED');
});
