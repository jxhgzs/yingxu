<script setup lang="ts">
import {ref, computed, nextTick, watch, onBeforeUnmount} from 'vue';
import type {EditorController} from '../controller.ts';
import type {Clip, Track} from '../../../../packages/core/src/document.ts';
import {atFrame, timecode} from '../controller.ts';
import {toNumber, add, mul, sub, compare, rational} from '../../../../packages/core/src/time.ts';
import Icon from './Icon.vue';
import {curveTrimSourceDelta,curveNearestFrame} from '../../../../packages/core/src/curve-speed.ts';
import {targetTimeAt} from '../../../../packages/core/src/animation.ts';
import {transitionWindow} from '../../../../packages/core/src/transitions.ts';
import {transitionPresentation} from '../transition-presentation.ts';
const props = defineProps<{c: EditorController}>();
const scroller = ref<HTMLElement>(), scrollLeft = ref(0), viewport = ref(1400);
let scrubPointer:number|undefined,scrubTarget:HTMLElement|undefined,scrubFrame:number|undefined,scrubX:number|undefined;
const drag = ref<{id: string; mode: 'move'|'left'|'right'; originX: number; delta: number; trackId: string; destination: string; original: Clip} | null>(null);
const timelineDuration = computed(() => Math.max(18, props.c.total.value + 6));
const width = computed(() => Math.max(viewport.value, 144 + timelineDuration.value * props.c.zoom.value));
const rate = computed(() => props.c.doc.value ? toNumber(props.c.doc.value.fps) : 30);
const ticks = computed(() => {
  const step = props.c.zoom.value >= 80 ? 1 : 2, first = Math.max(0, Math.floor((scrollLeft.value-144)/props.c.zoom.value/step));
  return Array.from({length: Math.min(100,Math.ceil(viewport.value/props.c.zoom.value/step)+3)}, (_,i) => (first+i)*step).filter(n=>n<=timelineDuration.value);
});
const rows = computed(() => [...(props.c.doc.value?.tracks || [])].reverse());
function onScroll() {if(scroller.value){scrollLeft.value=scroller.value.scrollLeft;viewport.value=scroller.value.clientWidth;}}
function visible(clip: Clip) {const start=toNumber(clip.target.start)*props.c.zoom.value+144,end=start+toNumber(clip.target.duration)*props.c.zoom.value;return end>=scrollLeft.value&&start<=scrollLeft.value+viewport.value+200;}
function name(clip: Clip) {return clip.text?.content || props.c.doc.value?.assets.find(a=>a.id===clip.materialId)?.name || '视频片段';}
function keyframes(clip:Clip){
  const points=new Map<string,{time:number;percent:number}>();
  for(const animation of clip.animations||[])for(const p of animation.points){
    if(compare(p.time,clip.source.start)<0||compare(p.time,add(clip.source.start,clip.source.duration))>0)continue;
    const time=targetTimeAt(clip,p.time);points.set(`${time.numerator}/${time.denominator}`,{time:toNumber(time),percent:toNumber(sub(time,clip.target.start))/toNumber(clip.target.duration)*100});
  }
  return [...points.values()].sort((a,b)=>a.time-b.time);
}
function seekX(clientX:number) {
  if(!scroller.value||!props.c.doc.value)return;
  const x=clientX-scroller.value.getBoundingClientRect().left+scroller.value.scrollLeft-144;
  props.c.playing.value=false;props.c.seek(toNumber(atFrame(x/props.c.zoom.value,props.c.doc.value!.fps)));
}
function flushScrub(){if(scrubFrame!==undefined)cancelAnimationFrame(scrubFrame);scrubFrame=undefined;if(scrubX!==undefined){const x=scrubX;scrubX=undefined;seekX(x);}}
function beginScrub(event:PointerEvent){
  if(event.button!==0||event.isPrimary===false||scrubPointer!==undefined||!scroller.value||!props.c.doc.value||event.clientX<scroller.value.getBoundingClientRect().left+144)return;
  event.preventDefault();scrubPointer=event.pointerId;scrubTarget=event.currentTarget as HTMLElement;scrubTarget.setPointerCapture(event.pointerId);
  props.c.scrubbing.value=true;seekX(event.clientX);
}
function moveScrub(event:PointerEvent){if(event.pointerId!==scrubPointer)return;scrubX=event.clientX;if(scrubFrame===undefined)scrubFrame=requestAnimationFrame(()=>{scrubFrame=undefined;flushScrub();});}
function cancelScrub(flush=true){
  if(flush)flushScrub();else {if(scrubFrame!==undefined)cancelAnimationFrame(scrubFrame);scrubFrame=undefined;scrubX=undefined;}
  const target=scrubTarget,id=scrubPointer;scrubPointer=undefined;scrubTarget=undefined;props.c.scrubbing.value=false;
  if(id!==undefined&&target?.hasPointerCapture(id))target.releasePointerCapture(id);
}
function finishScrub(event:PointerEvent){if(event.pointerId!==scrubPointer)return;scrubX=event.clientX;cancelScrub();}
function lostScrub(event:PointerEvent){if(event.pointerId===scrubPointer)cancelScrub();}
watch(()=>props.c.state.value?.id,()=>cancelScrub(false));
onBeforeUnmount(()=>cancelScrub(false));
function begin(event: PointerEvent, clip: Clip, track: Track, mode: 'move'|'left'|'right') {
  props.c.selectedId.value=clip.id;
  if(event.button!==0||track.locked||props.c.readOnly.value||props.c.busy.value||clip.speedCurve&&clip.animations?.length&&mode!=='move')return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag.value={id:clip.id,mode,originX:event.clientX,delta:0,trackId:track.id,destination:track.id,original:structuredClone(clip)};
}
function moving(event: PointerEvent) {
  if(!drag.value)return;
  drag.value.delta=(event.clientX-drag.value.originX)/props.c.zoom.value;
  const row=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-track-id]');
  const candidate=props.c.doc.value?.tracks.find(t=>t.id===row?.dataset.trackId),original=props.c.doc.value?.tracks.find(t=>t.id===drag.value!.trackId);
  if(candidate&&candidate.kind===original?.kind&&!candidate.locked)drag.value.destination=candidate.id;
}
function snapTime(value: number, clip: Clip) {
  const candidates=[0,props.c.playhead.value,...props.c.doc.value!.tracks.flatMap(t=>t.clips.filter(c=>c.id!==clip.id).flatMap(c=>[toNumber(c.target.start),toNumber(add(c.target.start,c.target.duration))]))];
  let snapped=Math.max(0,value),distance=8/props.c.zoom.value;
  if(props.c.snap.value)for(const x of candidates)if(Math.abs(x-value)<distance){snapped=x;distance=Math.abs(x-value);}
  return atFrame(snapped,props.c.doc.value!.fps);
}
function finish() {
  const d=drag.value;drag.value=null;if(!d||Math.abs(d.delta*props.c.zoom.value)<3)return;
  const clip=d.original,fps=props.c.doc.value!.fps;
  if(d.mode==='move')props.c.guard(()=>props.c.edit({type:'clip.move',clipId:d.id,trackId:d.destination,start:snapTime(toNumber(clip.target.start)+d.delta,clip)}));
  else if(d.mode==='right'){
    const snapped=snapTime(toNumber(add(clip.target.start,clip.target.duration))+d.delta,clip),end=clip.speedCurve?curveNearestFrame(snapped,fps):snapped;
    props.c.guard(()=>props.c.edit({type:'clip.trim',clipId:d.id,sourceStart:clip.source.start,sourceDuration:clip.speedCurve?add(clip.source.duration,curveTrimSourceDelta(clip.speedCurve,sub(end,add(clip.target.start,clip.target.duration)))):mul(sub(end,clip.target.start),clip.speed),pushFollowing:props.c.trimFollowing.value}));
  }else{
    const snapped=snapTime(toNumber(clip.target.start)+d.delta,clip),start=clip.speedCurve?curveNearestFrame(snapped,fps):snapped,delta=sub(start,clip.target.start),sourceDelta=clip.speedCurve?curveTrimSourceDelta(clip.speedCurve,delta):mul(delta,clip.speed);
    props.c.guard(()=>props.c.edit({type:'clip.trim',clipId:d.id,sourceStart:add(clip.source.start,sourceDelta),sourceDuration:sub(clip.source.duration,sourceDelta),targetStart:start,pushFollowing:props.c.trimFollowing.value}));
  }
}
function clipStyle(clip: Clip) {
  let start=toNumber(clip.target.start),length=toNumber(clip.target.duration);
  if(drag.value?.id===clip.id){if(drag.value.mode==='move')start+=drag.value.delta;else if(drag.value.mode==='right')length+=drag.value.delta;else {start+=drag.value.delta;length-=drag.value.delta;}}
  const asset=props.c.doc.value!.assets.find(a=>a.id===clip.materialId)!;
  return {left:144+Math.max(0,start)*props.c.zoom.value+'px',width:Math.max(6,length*props.c.zoom.value)+'px',backgroundImage:asset.kind==='text'?undefined:`url("${props.c.api.url('/media/'+asset.id+'/thumb')}")`};
}
async function drop(event: DragEvent, track: Track) {
  const id=event.dataTransfer?.getData('application/x-yingxu-asset'),asset=props.c.assets.value.find(a=>a.id===id);
  if(!asset||!scroller.value)return;
  const x=event.clientX-scroller.value.getBoundingClientRect().left+scroller.value.scrollLeft-144;
  await props.c.guard(()=>props.c.addAsset(asset,track.id,Math.max(0,x/props.c.zoom.value)));
}
function addTrack(kind: Track['kind']) {return props.c.guard(()=>props.c.edit({type:'track.add',track:{id:crypto.randomUUID(),kind,name:kind==='video'?'视频轨道':kind==='audio'?'音频轨道':'文字轨道',clips:[]}}));}
async function selectTransition(clipId:string){
  const projectId=props.c.state.value?.id;props.c.selectedId.value=clipId;
  await nextTick();
  if(props.c.state.value?.id===projectId&&props.c.selectedId.value===clipId)props.c.inspectorTab.value='transition';
}
</script>
<template>
  <section class="timeline-panel panel">
    <div class="timeline-tools">
      <div class="tool-group"><a-tooltip title="撤销 ⌘Z"><button class="icon-button" aria-label="撤销" :disabled="!c.state.value?.canUndo||c.busy.value||c.readOnly.value" @click="c.guard(()=>c.edit(undefined,'undo'))"><Icon name="undo" /></button></a-tooltip><a-tooltip title="重做 ⇧⌘Z"><button class="icon-button" aria-label="重做" :disabled="!c.state.value?.canRedo||c.busy.value||c.readOnly.value" @click="c.guard(()=>c.edit(undefined,'redo'))"><Icon name="redo" /></button></a-tooltip></div>
      <div class="tool-group"><a-tooltip title="在播放头处分割 ⌘B"><button class="icon-button" aria-label="分割" :disabled="!c.selected.value||c.busy.value||c.readOnly.value" @click="c.guard(c.split)"><Icon name="split" /></button></a-tooltip><a-tooltip title="删除片段"><button class="icon-button" aria-label="删除片段" :disabled="!c.selected.value||c.busy.value||c.readOnly.value" @click="c.guard(()=>c.remove(false))"><Icon name="delete" /></button></a-tooltip><a-tooltip title="复制到轨道末尾"><button class="icon-button" aria-label="复制片段" :disabled="!c.selected.value||c.busy.value||c.readOnly.value" @click="c.guard(c.duplicate)"><Icon name="copy" /></button></a-tooltip></div>
      <a-dropdown><a-button size="small" class="add-track" :disabled="c.readOnly.value||c.busy.value"><Icon name="plus" />轨道<Icon name="down" /></a-button><template #overlay><a-menu @click="({key}:any)=>addTrack(key)"><a-menu-item key="video">视频轨道</a-menu-item><a-menu-item key="audio">音频轨道</a-menu-item><a-menu-item key="text">文字轨道</a-menu-item></a-menu></template></a-dropdown>
      <div class="timeline-tools-right"><a-tooltip title="吸附到片段边缘与播放头"><button class="icon-button" :class="{active:c.snap.value}" aria-label="时间线吸附" :aria-pressed="c.snap.value" @click="c.snap.value=!c.snap.value"><Icon name="link" /></button></a-tooltip><Icon name="zoomOut" /><a-slider :value="c.zoom.value" :min="32" :max="200" :tooltip-open="false" @change="(v:any)=>c.zoom.value=Number(v)" /><Icon name="zoomIn" /></div>
    </div>
    <div ref="scroller" class="timeline-scroll" :data-scrubbing="c.scrubbing.value" @scroll="onScroll" @pointermove="moveScrub" @pointerup="finishScrub" @pointercancel="lostScrub" @lostpointercapture="lostScrub">
      <div class="timeline-canvas" :style="{width:width+'px',minHeight:'100%'}">
        <div class="time-ruler" @pointerdown="beginScrub"><span class="ruler-origin">{{c.doc.value ? toNumber(c.doc.value.fps).toFixed(2).replace('.00','') : '30'}} fps</span><span v-for="tick in ticks" :key="tick" class="ruler-tick" :style="{left:144+tick*c.zoom.value+'px'}"><i></i>{{timecode(tick,rate).slice(3,8)}}</span></div>
        <div v-for="track in rows" :key="track.id" :data-track-id="track.id" class="track-row" :class="['track-'+track.kind,{locked:track.locked}]" @dragover.prevent @drop.prevent="drop($event,track)" @pointerdown.self="beginScrub">
          <header class="track-header"><div><Icon :name="track.kind" /><span>{{track.name||track.kind}}</span></div><div class="track-switches">
            <button class="mini-icon" :aria-label="(track.locked?'解锁':'锁定')+(track.name||track.kind)" @click="c.guard(()=>c.edit({type:'track.update',trackId:track.id,changes:{locked:!track.locked}}))"><Icon :name="track.locked?'lock':'unlock'" /></button>
            <button v-if="track.kind!=='audio'" class="mini-icon" :class="{off:track.hidden}" :aria-label="(track.hidden?'显示':'隐藏')+(track.name||track.kind)" @click="c.guard(()=>c.edit({type:'track.update',trackId:track.id,changes:{hidden:!track.hidden}}))"><Icon :name="track.hidden?'hidden':'eye'" /></button>
            <button v-else class="mini-icon" :class="{off:track.muted}" :aria-label="(track.muted?'取消静音':'静音')+(track.name||track.kind)" @click="c.guard(()=>c.edit({type:'track.update',trackId:track.id,changes:{muted:!track.muted}}))"><Icon name="sound" /></button>
          </div></header>
          <button v-for="clip in track.clips.filter(visible)" :key="clip.id" class="timeline-clip" :class="[{selected:c.selectedId.value===clip.id,dragging:drag?.id===clip.id},'clip-'+track.kind]" :style="clipStyle(clip)" :aria-label="'片段 '+name(clip)" :data-clip-id="clip.id" @pointerdown.stop="begin($event,clip,track,'move')" @pointermove="moving" @pointerup="finish" @pointercancel="drag=null" @click.stop="c.selectedId.value=clip.id">
            <span class="clip-title"><Icon :name="track.kind" />{{name(clip)}}<small>{{clip.speedCurve?'曲线':toNumber(clip.speed)!==1?toNumber(clip.speed)+'×':''}}</small></span><span v-if="track.kind==='text'" class="clip-text-body">{{clip.text?.content}}</span>
            <span v-for="point in keyframes(clip)" :key="point.time" class="timeline-keyframe" :style="{left:'clamp(4px, '+point.percent+'%, calc(100% - 4px))'}" :title="'关键帧 '+timecode(point.time,rate)" @pointerdown.stop @pointerup.stop @click.stop="c.selectedId.value=clip.id;c.playing.value=false;c.seek(point.time)">◆</span>
            <template v-if="!clip.speedCurve||!clip.animations?.length"><span class="trim-handle left" :aria-label="'裁切左边缘 '+name(clip)" @pointerdown.stop="begin($event,clip,track,'left')" @pointermove="moving" @pointerup.stop="finish"></span><span class="trim-handle right" :aria-label="'裁切右边缘 '+name(clip)" @pointerdown.stop="begin($event,clip,track,'right')" @pointermove="moving" @pointerup.stop="finish"></span></template>
          </button>
          <button v-for="transition in (c.doc.value?.transitions||[]).filter(t=>t.trackId===track.id)" :key="transition.id" class="timeline-transition" :aria-label="transitionPresentation[transition.kind].name+'转场 '+toNumber(transition.duration).toFixed(3)+' 秒'" :style="{left:144+toNumber(transitionWindow(transition,track.clips.find(x=>x.id===transition.outgoingClipId)!).start)*c.zoom.value+'px',width:Math.max(16,toNumber(transition.duration)*c.zoom.value)+'px'}" @click.stop="selectTransition(transition.outgoingClipId)">{{transitionPresentation[transition.kind].icon}}</button>
          <span v-if="!track.clips.length" class="empty-track-hint">{{track.kind==='text'?'添加文字':track.kind==='audio'?'拖入音频素材':'拖入视频或图片'}}</span>
        </div>
        <div class="playhead" :style="{left:144+c.playhead.value*c.zoom.value+'px'}"><button class="playhead-handle" aria-label="拖动播放头" @pointerdown.stop="beginScrub"></button></div>
      </div>
    </div>
    <footer class="timeline-footer"><span>{{c.doc.value?.tracks.reduce((n,t)=>n+t.clips.length,0)||0}} 个片段</span><span>{{c.selected.value?'已选中 '+(c.selected.value.asset.name||'文字'):'点击选择片段 · 拖动调整位置'}}</span><span>{{c.state.value?.document.canvas.width}} × {{c.state.value?.document.canvas.height}}</span></footer>
  </section>
</template>
