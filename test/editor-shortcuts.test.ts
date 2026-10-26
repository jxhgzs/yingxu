import test from 'node:test';import assert from 'node:assert/strict';
import {resolveShortcut,runShortcut,shortcutTargetOwnsKeys,handleShortcut} from '../apps/editor/src/shortcuts.ts';
import {createEditorController} from '../apps/editor/src/controller.ts';
import {emptyDocument} from '../packages/core/src/document.ts';
import {rational,frameTime,toNumber} from '../packages/core/src/time.ts';
const key=(key:string,extra:Record<string,unknown>={})=>({key,code:key===' '?'Space':key,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,repeat:false,isComposing:false,keyCode:0,...extra});
function fixture(){const c=createEditorController(),document=emptyDocument();document.fps=rational(30000,1001);document.assets.push({id:'a',path:'/fixture',duration:rational(10),kind:'video'});document.tracks[0].clips.push({id:'c',materialId:'a',source:{start:rational(0),duration:rational(10)},target:{start:rational(0),duration:rational(10)},speed:rational(1),editableTiming:true});c.state.value={id:'p',revision:0,document,documentHash:'hash',updatedAt:'',canUndo:true,canRedo:true,diagnostics:[]};c.loading.value=false;c.selectedId.value='c';return c;}
test('Space works with key or code, ignores modifiers/IME and only toggles once on a hold',()=>{
 assert.equal(resolveShortcut(key(' ')),'play');assert.equal(resolveShortcut(key('Unidentified',{code:'Space'})),'play');
 for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229}])assert.equal(resolveShortcut(key(' ',extra)),undefined);
 assert.equal(resolveShortcut(key(' ',{repeat:true})),'play');
 assert.equal(resolveShortcut(key('ArrowRight',{repeat:true})),'next');assert.equal(resolveShortcut(key('ArrowLeft',{shiftKey:true})),'back10');
});
test('common shortcuts have explicit modifier and repeat rules',()=>{
 for(const [k,extra,expected] of [['b',{metaKey:true},'split'],['d',{ctrlKey:true},'duplicate'],['z',{metaKey:true},'undo'],['z',{ctrlKey:true,shiftKey:true},'redo'],['y',{ctrlKey:true},'redo'],['s',{metaKey:true},'save'],['Backspace',{shiftKey:true},'ripple'],['Delete',{},'delete'],['Home',{},'start'],['End',{},'end'],['Escape',{},'deselect']] as const)assert.equal(resolveShortcut(key(k,extra)),expected);
 for(const [k,extra] of [['b',{metaKey:true,shiftKey:true}],['Delete',{metaKey:true}],['ArrowRight',{ctrlKey:true}],['z',{metaKey:true,altKey:true}],['b',{ctrlKey:true,altKey:true}]] as const)assert.equal(resolveShortcut(key(k,extra)),undefined);
});
test('transport uses the live preview readiness without a background job; pause and replay at end work',()=>{
 const c=fixture();assert.equal(c.preview.value,null);runShortcut('play',c);assert.equal(c.playing.value,false);
 c.playbackReady.value=true;c.loading.value=true;runShortcut('play',c);assert.equal(c.playing.value,false);c.loading.value=false;c.scrubbing.value=true;runShortcut('play',c);assert.equal(c.playing.value,false);c.scrubbing.value=false;runShortcut('play',c);assert.equal(c.playing.value,true);c.playbackReady.value=false;runShortcut('play',c);assert.equal(c.playing.value,false);
 c.playhead.value=c.total.value;c.playbackReady.value=true;runShortcut('play',c);assert.equal(c.playhead.value,0);assert.equal(c.playing.value,true);c.dispose();
});
test('frame steps pause and use project fps without accumulation drift or crossing project bounds',()=>{
 const c=fixture();c.playing.value=true;for(let i=0;i<100;i++)runShortcut('next',c);assert.equal(c.playing.value,false);assert.equal(c.playhead.value,toNumber(frameTime(100,c.doc.value!.fps)));
 runShortcut('back10',c);assert.equal(c.playhead.value,toNumber(frameTime(90,c.doc.value!.fps)));runShortcut('start',c);runShortcut('previous',c);assert.equal(c.playhead.value,0);runShortcut('end',c);assert.equal(c.playhead.value,10);runShortcut('next',c);assert.equal(c.playhead.value,10);c.dispose();
});
test('edit shortcuts enforce busy/read-only/locked/selection/history and split interior',async()=>{
 const c=fixture(),calls:string[]=[];c.edit=async(_command,action)=>{calls.push(action!);return undefined;};c.split=async()=>{calls.push('split');};c.remove=async ripple=>{calls.push(ripple?'ripple':'delete');};c.duplicate=async()=>{calls.push('duplicate');};c.flush=async()=>{calls.push('save');};
 runShortcut('split',c);assert.deepEqual(calls,[]);c.seek(1);runShortcut('split',c);runShortcut('duplicate',c);runShortcut('ripple',c);runShortcut('undo',c);runShortcut('redo',c);runShortcut('save',c);assert.deepEqual(calls,['split','duplicate','ripple','undo','redo','save']);calls.length=0;
 c.busy.value=true;for(const action of ['split','duplicate','delete','undo','redo'] as const)runShortcut(action,c);c.busy.value=false;c.state.value={...c.state.value!,diagnostics:[{code:'unknown'}]};runShortcut('delete',c);c.state.value={...c.state.value!,diagnostics:[]};const locked=structuredClone(c.state.value!);locked.document.tracks[0].locked=true;c.state.value=locked;for(const action of ['split','duplicate','delete'] as const)runShortcut(action,c);c.state.value!.canUndo=false;c.state.value!.canRedo=false;runShortcut('undo',c);runShortcut('redo',c);assert.deepEqual(calls,[]);
 runShortcut('deselect',c);assert.equal(c.selectedId.value,null);c.dispose();
});
test('target guard delegates text, controls and modal/menu semantics, but not ordinary buttons',()=>{
 const target={isContentEditable:false,closest:(_selector:string)=>null};
 assert.equal(shortcutTargetOwnsKeys(target),false);
 assert.equal(shortcutTargetOwnsKeys({...target,isContentEditable:true}),true);assert.equal(shortcutTargetOwnsKeys({...target,closest:()=>({})}),true);
});

test('captured Space consumes the button default, repeated keydowns, and obeys modal/focus guards',()=>{
 const c=fixture();c.playbackReady.value=true;let prevented=0,stopped=0;
 const event=(extra={})=>({...key(' ',extra),target:{closest:()=>null},defaultPrevented:false,preventDefault:()=>prevented++,stopPropagation:()=>stopped++}) as unknown as KeyboardEvent;
 assert.equal(handleShortcut(event(),c),true);assert.equal(c.playing.value,true);
 assert.equal(handleShortcut(event({repeat:true}),c),true);assert.equal(c.playing.value,true);assert.equal(prevented,2);assert.equal(stopped,2);
 assert.equal(handleShortcut(event(),c,true),false);assert.equal(c.playing.value,true);
 assert.equal(handleShortcut({...event(),target:{isContentEditable:true,closest:()=>null}} as unknown as KeyboardEvent,c),false);assert.equal(c.playing.value,true);
 handleShortcut(event(),c);assert.equal(c.playing.value,false);c.dispose();
});
