<script setup lang="ts">
import {computed} from 'vue';import type {EditorController} from '../controller.ts';import Icon from './Icon.vue';
import {toNumber,add} from '../../../../packages/core/src/time.ts';
const props=defineProps<{c:EditorController}>();const emit=defineEmits<{crop:[];markers:[]}>();
const selected=computed(()=>props.c.selected.value),blocked=computed(()=>props.c.loading.value?'正在打开工程':props.c.busy.value?'正在处理操作':props.c.readOnly.value?'此工程只读':!selected.value?'请先选择片段':selected.value.track.locked?'所选轨道已锁定':'');
const inside=computed(()=>!!selected.value&&props.c.playhead.value>=toNumber(selected.value.clip.target.start)&&props.c.playhead.value<toNumber(add(selected.value.clip.target.start,selected.value.clip.target.duration)));
const boundary=computed(()=>inside.value&&props.c.playhead.value>toNumber(selected.value!.clip.target.start));
const transition=computed(()=>props.c.doc.value?.transitions?.some(t=>t.outgoingClipId===selected.value?.clip.id||t.incomingClipId===selected.value?.clip.id));
const timingReason=computed(()=>blocked.value||(!boundary.value?'请将播放头移到片段内部':transition.value?'请先移除片段上的转场':selected.value?.clip.textAnimations?.length?'请先移除文字动画':selected.value?.clip.speedCurve&&selected.value.clip.animations?.length?'此曲线含属性关键帧，暂不支持时间裁切':''));
const visualReason=computed(()=>blocked.value||(!['video','image'].includes(selected.value?.asset.kind||'video')?'请选择视频或图片':''));
const videoReason=computed(()=>blocked.value||((selected.value?.asset.kind||'video')!=='video'?'请选择视频片段':transition.value?'请先移除片段上的转场':''));
const tools=computed(()=>[
 {id:'split',label:'分割',hint:'⌘ / Ctrl B',reason:timingReason.value,run:props.c.split},
 {id:'cutLeft',label:'向左裁切',hint:'裁掉播放头左侧',reason:timingReason.value,run:()=>props.c.quickCut('left')},
 {id:'cutRight',label:'向右裁切',hint:'裁掉播放头右侧',reason:timingReason.value,run:()=>props.c.quickCut('right')},
 {id:'delete',label:'删除片段',hint:'Delete / Backspace',reason:blocked.value||(transition.value?'请先移除片段上的转场':''),run:()=>props.c.remove(false)},
 {id:'marker',label:'添加标记',hint:'M · 右键管理标记',reason:props.c.busy.value||props.c.readOnly.value||props.c.loading.value?'当前无法添加标记':'',run:props.c.addMarker},
 {id:'freeze',label:'定格',hint:'在播放头插入定格画面',reason:videoReason.value||(!inside.value?'请将播放头移到所选视频内':selected.value?.clip.speedCurve&&selected.value.clip.animations?.length?'此曲线含属性关键帧，暂不支持分段':''),run:()=>props.c.mediaOperation('freeze')},
 {id:'reverse',label:'倒放',hint:'生成独立倒放素材',reason:videoReason.value,run:()=>props.c.mediaOperation('reverse')},
 {id:'mirror',label:'镜像',hint:'水平翻转',reason:visualReason.value,run:props.c.mirror},
 {id:'rotate',label:'旋转',hint:'顺时针 90°',reason:visualReason.value,run:props.c.rotate},
 {id:'crop',label:'裁剪比例',hint:'裁剪画面范围',reason:visualReason.value,run:async()=>emit('crop')}
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
 <div class="tool-group timeline-extra-tools"><a-tooltip title="复制到轨道末尾 ⌘ / Ctrl D"><button class="icon-button" aria-label="复制片段" :disabled="!!blocked" @click="perform(c.duplicate,$event)"><Icon name="copy" /></button></a-tooltip><a-dropdown><a-button class="add-track" :disabled="c.readOnly.value||c.busy.value"><Icon name="plus" />轨道<Icon name="down" /></a-button><template #overlay><a-menu @click="({key}:any)=>addTrack(key)"><a-menu-item key="video">视频轨道</a-menu-item><a-menu-item key="audio">音频轨道</a-menu-item><a-menu-item key="text">文字轨道</a-menu-item></a-menu></template></a-dropdown><a-tooltip title="管理标记"><button class="icon-button" aria-label="管理标记" @click="emit('markers')"><Icon name="markerList" /></button></a-tooltip></div>
 <div class="timeline-tools-right"><a-tooltip title="主轨磁吸：快速裁切时前移后续片段"><button class="icon-button" aria-label="主轨磁吸" :aria-pressed="c.doc.value?.mainTrackMagnet!==false" :class="{active:c.doc.value?.mainTrackMagnet!==false}" :disabled="!c.doc.value||c.busy.value||c.readOnly.value" @click="perform(()=>c.edit({type:'project.settings',mainTrackMagnet:c.doc.value?.mainTrackMagnet===false}),$event)"><Icon name="magnet" /></button></a-tooltip><a-tooltip title="吸附到片段边缘与播放头"><button class="icon-button" :class="{active:c.snap.value}" aria-label="时间线吸附" :aria-pressed="c.snap.value" @click="c.snap.value=!c.snap.value"><Icon name="link" /></button></a-tooltip><Icon name="zoomOut" /><a-slider :value="c.zoom.value" :min="32" :max="200" :tooltip-open="false" @change="(v:any)=>c.zoom.value=Number(v)" /><Icon name="zoomIn" /></div>
</div></template>
