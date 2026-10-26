import type {EditorController} from './controller.ts';
import {add,toNumber} from '../../../packages/core/src/time.ts';

type Keys=Pick<KeyboardEvent,'key'|'code'|'metaKey'|'ctrlKey'|'shiftKey'|'altKey'|'repeat'|'isComposing'|'keyCode'>;
export type ShortcutAction='play'|'previous'|'next'|'back10'|'forward10'|'start'|'end'|'split'|'duplicate'|'undo'|'redo'|'save'|'delete'|'ripple'|'deselect'|'mark';
export const shortcutHelp=[
 ['添加标记','M'],['播放 / 暂停','Space'],['上一帧 / 下一帧','← / →'],['后退 / 前进 10 帧','Shift + ← / →'],['跳到开头 / 结尾','Home / End'],
 ['分割所选片段','⌘ / Ctrl + B'],['复制到本轨末尾','⌘ / Ctrl + D'],['撤销','⌘ / Ctrl + Z'],['重做','Shift + ⌘ / Ctrl + Z · Ctrl + Y'],
 ['完成自动保存','⌘ / Ctrl + S'],['删除片段','Delete / Backspace'],['涟漪删除','Shift + Delete / Backspace'],['取消选择','Esc']
] as const;
export function resolveShortcut(event:Keys):ShortcutAction|undefined{
 if(event.altKey||event.isComposing||event.keyCode===229)return;
 const key=event.key.toLowerCase(),modifier=event.metaKey||event.ctrlKey;
 if(modifier){
  if(key==='z')return event.shiftKey?'redo':'undo';
  if(event.shiftKey)return;
  if(key==='y'&&event.ctrlKey&&!event.metaKey)return 'redo';
  return key==='b'?'split':key==='d'?'duplicate':key==='s'?'save':undefined;
 }
 if(key==='arrowleft')return event.shiftKey?'back10':'previous';
 if(key==='arrowright')return event.shiftKey?'forward10':'next';
 if(key==='delete'||key==='backspace')return event.shiftKey?'ripple':'delete';
 if(event.shiftKey)return;
 if(event.code==='Space'||key===' ')return 'play';
 if(key==='m')return 'mark';
 return key==='home'?'start':key==='end'?'end':key==='escape'?'deselect':undefined;
}
export function shortcutTargetOwnsKeys(target:{isContentEditable?:boolean;closest(selector:string):unknown}):boolean{
 return !!(target.isContentEditable||target.closest('input,textarea,select,a,summary,[role="textbox"],[role="slider"],[role="spinbutton"],[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"],[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"],.ant-select-dropdown,.ant-dropdown'));
}
const repeatable=new Set<ShortcutAction>(['previous','next','back10','forward10']);
export function handleShortcut(event:KeyboardEvent,c:EditorController,blocked=false):boolean{
 const target=event.target as HTMLElement|null;
 if(blocked||event.defaultPrevented||!target?.closest||shortcutTargetOwnsKeys(target))return false;
 const action=resolveShortcut(event);if(!action)return false;
 // Consume held Space too: allowing the default could click the focused button on keyup.
 event.preventDefault();event.stopPropagation();
 if(!event.repeat||repeatable.has(action))runShortcut(action,c);
 return true;
}
export function runShortcut(action:ShortcutAction,c:EditorController):void{
 if(action==='play'){c.togglePlayback();return;}
 if(action==='deselect'){c.selectedId.value=null;return;}
 if(action==='save'){void c.guard(c.flush);return;}
 if(c.loading.value||!c.doc.value)return;
 if(action==='previous'||action==='next'||action==='back10'||action==='forward10'){
  c.stepFrames({previous:-1,next:1,back10:-10,forward10:10}[action]);return;
 }
 if(action==='start'||action==='end'){c.playing.value=false;c.seek(action==='start'?0:c.total.value);return;}
 if(c.busy.value||c.readOnly.value)return;
 if(action==='undo'||action==='redo'){
  if(action==='undo'?c.state.value?.canUndo:c.state.value?.canRedo)void c.guard(()=>c.edit(undefined,action));return;
 }
 if(action==='mark'){void c.guard(c.addMarker);return;}
 const selected=c.selected.value;if(!selected||selected.track.locked)return;
 if(action==='split'){
  const {start,duration}=selected.clip.target;
  if(c.playhead.value>toNumber(start)&&c.playhead.value<toNumber(add(start,duration)))void c.guard(c.split);
 }else if(action==='duplicate')void c.guard(c.duplicate);
 else if(action==='delete'||action==='ripple')void c.guard(()=>c.remove(action==='ripple'));
}
