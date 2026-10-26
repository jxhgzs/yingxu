<script setup lang="ts">
import {computed,shallowRef,watch} from 'vue';import {createTimelineToolResolver} from '../../../../packages/core/src/tool-availability.ts';import type {MediaToolProof} from '../../../../packages/core/src/tool-availability.ts';import {explainError} from '../api.ts';import {atFrame} from '../controller.ts';import type {EditorController} from '../controller.ts';import Icon from './Icon.vue';
import {rational} from '../../../../packages/core/src/time.ts';
const props=defineProps<{c:EditorController}>();const emit=defineEmits<{crop:[];markers:[]}>();
const selected=computed(()=>props.c.selected.value),blocked=computed(()=>props.c.loading.value?'TOOL_LOADING':props.c.busy.value?'TOOL_BUSY':props.c.readOnly.value?'TOOL_READ_ONLY':'');
const proof=shallowRef<MediaToolProof>({reason:'MEDIA_TOOL_CHECKING'});
watch(()=>{const a=selected.value?.asset;return a&&props.c.state.value?[props.c.state.value.id,a.id,a.sha256,a.path,a.kind,a.fps?.numerator,a.fps?.denominator].join('|'):'';},async(key,_,cleanup)=>{
 let stale=false;cleanup(()=>{stale=true;});proof.value={reason:'MEDIA_TOOL_CHECKING'};if(!key)return;
 const project=props.c.state.value!.id,asset=selected.value!.asset.id;
 try{const next=await props.c.api.get<MediaToolProof>(`/api/projects/${project}/media-tools?assetId=${encodeURIComponent(asset)}`);if(!stale)proof.value=next;}
 catch{if(!stale)proof.value={reason:'MEDIA_SOURCE_UNREADABLE',fileReason:'MEDIA_SOURCE_UNREADABLE'};}
},{immediate:true});
const resolveTools=createTimelineToolResolver();
const reasons=computed(()=>resolveTools(props.c.doc.value,props.c.selectedId.value,props.c.doc.value?atFrame(props.c.playhead.value,props.c.doc.value.fps):rational(0),proof.value,blocked.value));
const reason=(key:keyof typeof reasons.value)=>reasons.value[key]?explainError(Error(reasons.value[key])):'';
const selectedBlocked=computed(()=>blocked.value||(!selected.value?'TOOL_SELECT_CLIP':selected.value.track.locked?'TRACK_LOCKED':!selected.value.clip.editableTiming?'TIMING_NOT_INTERPRETED':''));
const tools=computed(()=>[
 {id:'split',label:'分割',hint:'⌘ / Ctrl B',reason:reason('split'),run:props.c.split},
 {id:'cutLeft',label:'向左裁切',hint:'裁掉播放头左侧',reason:reason('cutLeft'),run:()=>props.c.quickCut('left')},
 {id:'cutRight',label:'向右裁切',hint:'裁掉播放头右侧',reason:reason('cutRight'),run:()=>props.c.quickCut('right')},
 {id:'delete',label:'删除片段',hint:'Delete / Backspace',reason:reason('delete'),run:()=>props.c.remove(false)},
 {id:'marker',label:'添加标记',hint:'M · 右键管理标记',reason:reason('marker'),run:props.c.addMarker},
 {id:'freeze',label:'定格',hint:'在播放头插入定格画面',reason:reason('freeze'),run:()=>props.c.mediaOperation('freeze')},
 {id:'reverse',label:'倒放',hint:'生成独立倒放素材',reason:reason('reverse'),run:()=>props.c.mediaOperation('reverse')},
 {id:'mirror',label:'镜像',hint:'水平翻转',reason:reason('mirror'),run:props.c.mirror},
 {id:'rotate',label:'旋转',hint:'顺时针 90°',reason:reason('rotate'),run:props.c.rotate},
 {id:'crop',label:'裁剪比例',hint:'裁剪画面范围',reason:reason('crop'),run:async()=>emit('crop')}
]);
async function perform(action:()=>Promise<unknown>,event:MouseEvent){
 const trigger=(event.target as HTMLElement).closest('button');await props.c.guard(action);
 if(document.activeElement===document.body||document.activeElement===trigger)trigger?.closest<HTMLElement>('.yx-editor')?.focus({preventScroll:true});
}
function addTrack(kind:'video'|'audio'|'text'){return props.c.guard(()=>props.c.edit({type:'track.add',track:{id:crypto.randomUUID(),kind,name:kind==='video'?'视频轨道':kind==='audio'?'音频轨道':'文字轨道',clips:[]}}));}
</script>
<template><div class="timeline-tools">
 <div class="tool-group"><a-tooltip title="撤销 ⌘ / Ctrl Z"><button class="icon-button" aria-label="撤销" :disabled="!c.state.value?.canUndo||c.busy.value||c.readOnly.value" @click="perform(()=>c.edit(undefined,'undo'),$event)"><Icon name="undo" /></button></a-tooltip><a-tooltip title="重做 Shift ⌘ / Ctrl Z"><button class="icon-button" aria-label="重做" :disabled="!c.state.value?.canRedo||c.busy.value||c.readOnly.value" @click="perform(()=>c.edit(undefined,'redo'),$event)"><Icon name="redo" /></button></a-tooltip></div>
 <div class="tool-group primary-timeline-tools"><a-tooltip v-for="tool in tools" :key="tool.id" :title="tool.label+' · '+(tool.reason||tool.hint)"><span class="tool-button-wrap"><button class="icon-button" :aria-label="tool.label" :disabled="!!tool.reason" :title="tool.reason||tool.hint" @click="perform(tool.run,$event)" @contextmenu.prevent="tool.id==='marker'&&emit('markers')"><Icon :name="tool.id" /></button></span></a-tooltip></div>
 <div class="tool-group timeline-extra-tools"><a-tooltip title="复制到轨道末尾 ⌘ / Ctrl D"><button class="icon-button" aria-label="复制片段" :disabled="!!selectedBlocked" @click="perform(c.duplicate,$event)"><Icon name="copy" /></button></a-tooltip><a-dropdown><a-button class="add-track" :disabled="c.readOnly.value||c.busy.value"><Icon name="plus" />轨道<Icon name="down" /></a-button><template #overlay><a-menu @click="({key}:any)=>addTrack(key)"><a-menu-item key="video">视频轨道</a-menu-item><a-menu-item key="audio">音频轨道</a-menu-item><a-menu-item key="text">文字轨道</a-menu-item></a-menu></template></a-dropdown><a-tooltip title="管理标记"><button class="icon-button" :disabled="!c.doc.value||c.loading.value||c.busy.value" aria-label="管理标记" @click="emit('markers')"><Icon name="markerList" /></button></a-tooltip></div>
 <div class="timeline-tools-right"><a-tooltip title="主轨磁吸：快速裁切时前移后续片段"><button class="icon-button" aria-label="主轨磁吸" :aria-pressed="c.doc.value?.mainTrackMagnet!==false" :class="{active:c.doc.value?.mainTrackMagnet!==false}" :disabled="!c.doc.value||c.busy.value||c.readOnly.value" @click="perform(()=>c.edit({type:'project.settings',mainTrackMagnet:c.doc.value?.mainTrackMagnet===false}),$event)"><Icon name="magnet" /></button></a-tooltip><a-tooltip title="吸附到片段边缘与播放头"><button class="icon-button" :class="{active:c.snap.value}" aria-label="时间线吸附" :aria-pressed="c.snap.value" @click="c.snap.value=!c.snap.value"><Icon name="link" /></button></a-tooltip><Icon name="zoomOut" /><a-slider :value="c.zoom.value" :min="32" :max="200" :tooltip-open="false" @change="(v:any)=>c.zoom.value=Number(v)" /><Icon name="zoomIn" /></div>
</div></template>
