<script setup lang="ts">
import {ref, computed, watch, onBeforeUnmount} from 'vue';
import type {EditorController} from '../controller.ts';
import {timecode} from '../controller.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';
import Icon from './Icon.vue';
const props = defineProps<{c: EditorController}>();
const player = ref<HTMLVideoElement>();
const rate = computed(() => props.c.doc.value ? toNumber(props.c.doc.value.fps) : 30);
const ready = computed(() => !!props.c.preview.value?.result && props.c.preview.value.documentRevision === props.c.state.value?.revision && !props.c.previewPending.value);
const source = computed(() => props.c.preview.value?.result ? props.c.api.url(props.c.preview.value.result.url) : '');
watch(() => props.c.playing.value, async playing => {
  if (!player.value) return;
  if (playing && ready.value) {try {await player.value.play();} catch {props.c.playing.value=false;}}
  else player.value.pause();
});
watch(() => props.c.playhead.value, value => {
  if (player.value && Math.abs(player.value.currentTime-value) > .08) player.value.currentTime = Math.min(value, Math.max(0, (player.value.duration || 0)-.001));
});
function loaded() {if (player.value) player.value.currentTime=Math.min(props.c.playhead.value, Math.max(0,player.value.duration-.001));}
function update() {if (player.value && props.c.playing.value) props.c.playhead.value=player.value.currentTime;}
function step(delta: number) {props.c.playing.value=false;props.c.seek(props.c.playhead.value+delta/rate.value);}
onBeforeUnmount(() => {if (player.value) {player.value.pause();player.value.removeAttribute('src');player.value.load();}});
</script>
<template>
  <section class="preview-panel panel">
    <header class="panel-heading"><span>播放器</span><a-tooltip title="更新工程预览"><button class="icon-button" aria-label="重新生成预览" :disabled="c.readOnly.value||!c.total.value" @click="c.schedulePreview"><Icon name="reload" /></button></a-tooltip></header>
    <div class="preview-stage" :class="{updating:c.previewPending.value}">
      <video v-if="source" ref="player" :src="source" preload="auto" playsinline @loadedmetadata="loaded" @timeupdate="update" @ended="c.playing.value=false" @click="ready&&(c.playing.value=!c.playing.value)" />
      <div v-else class="preview-empty"><Icon name="video" /><span>{{c.readOnly.value?'此草稿暂不支持预览':'将素材添加到时间线开始剪辑'}}</span></div>
      <div v-if="c.previewPending.value" class="preview-updating"><a-spin size="small" /><span>正在更新预览</span></div>
      <span v-if="c.doc.value" class="preview-size">{{c.doc.value.canvas.width}} × {{c.doc.value.canvas.height}}</span>
    </div>
    <div class="player-transport"><div class="player-time"><strong>{{timecode(c.playhead.value,rate)}}</strong><span> / {{timecode(c.total.value,rate)}}</span></div>
      <div class="player-buttons"><button class="icon-button" aria-label="上一帧" :disabled="!ready" @click="step(-1)"><Icon name="previous" /></button><button class="play-button" :aria-label="c.playing.value?'暂停':'播放'" :disabled="!ready" @click="c.playing.value=!c.playing.value"><Icon :name="c.playing.value?'pause':'play'" /></button><button class="icon-button" aria-label="下一帧" :disabled="!ready" @click="step(1)"><Icon name="next" /></button></div>
      <span class="preview-fit">适应 <Icon name="down" /></span>
    </div>
  </section>
</template>
