<script setup lang="ts">
import {ref, shallowRef, computed, watch, onMounted, onBeforeUnmount} from 'vue';
import type {EditorController} from '../controller.ts';
import {timecode} from '../controller.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';
import {GpuPreview} from '../preview/index.ts';
import type {PreviewManifest} from '../preview/index.ts';
import type {PreviewColorDiagnostic} from '../preview/diagnostics.ts';
import Icon from './Icon.vue';
const props=defineProps<{c:EditorController}>();
const player=ref<HTMLVideoElement>(),canvas=ref<HTMLCanvasElement>(),manifest=shallowRef<PreviewManifest>(),gpuError=ref(''),mode=ref<'auto'|'rendered'>('auto'),details=ref(false);
const colorDiagnostic=shallowRef<PreviewColorDiagnostic>();
let engine:GpuPreview|undefined,epoch=0,disposed=false,engineTime=false;
const rate=computed(()=>props.c.doc.value?toNumber(props.c.doc.value.fps):30);
const realtime=computed(()=>mode.value==='auto'&&!!manifest.value?.support.supported&&!['fallback','context-lost','disposed'].includes(manifest.value.state));
const renderedReady=computed(()=>!!props.c.preview.value?.result&&props.c.preview.value.documentRevision===props.c.state.value?.revision&&!props.c.previewPending.value);
const ready=computed(()=>realtime.value?['ready','playing','paused','buffering'].includes(manifest.value!.state):renderedReady.value);
const source=computed(()=>props.c.preview.value?.result?props.c.api.url(props.c.preview.value.result.url):'');
const waiting=computed(()=>realtime.value?['loading','buffering'].includes(manifest.value!.state):props.c.previewPending.value);
const backendLabel=computed(()=>realtime.value&&manifest.value?.previewQuality==='exact-frames'?'精确预览':realtime.value?(manifest.value?.renderer.softwareRenderer?'WebGL 实时':'GPU 实时'):'后台预览');
const reason=computed(()=>gpuError.value||manifest.value?.support.reasons.map(r=>r.message).join('；')||'');
function accept(next:PreviewManifest){
  if(disposed)return;manifest.value=next;
  props.c.setRealtimePreviewAvailable(mode.value==='auto'&&next.support.supported&&!['fallback','context-lost','disposed'].includes(next.state));
  if(['fallback','context-lost'].includes(next.state))props.c.playing.value=false;
}
function createEngine(){
  if(!canvas.value||disposed)return;
  try{engine=new GpuPreview(canvas.value,{mediaUrl:asset=>props.c.api.url(`/media/${encodeURIComponent(asset.id)}`),textTexture:async(clipId,context,signal)=>{
    const response=await fetch(props.c.api.url(`/api/projects/${encodeURIComponent(context.projectId)}/textures`),{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':props.c.api.token},body:JSON.stringify({revision:context.revision,clipId,...(context.mode?{mode:context.mode}:{}),...(context.frame!==undefined?{frame:context.frame}:{})}),signal});
    const texture=await response.json();if(!response.ok)throw Error(texture.error||'TEXT_TEXTURE_REQUEST_FAILED');return {...texture,url:props.c.api.url(texture.url)};
  },curveAudio:async(clipId,context,signal)=>{
    const response=await fetch(props.c.api.url(`/api/projects/${encodeURIComponent(context.projectId)}/curve-audio`),{method:'POST',headers:{'Content-Type':'application/json','x-editor-token':props.c.api.token},body:JSON.stringify({revision:context.revision,clipId}),signal});
    const audio=await response.json();if(!response.ok)throw Error(audio.error||'CURVE_AUDIO_REQUEST_FAILED');return {...audio,url:props.c.api.url(audio.url)};
  },onState:accept,onMetrics:accept,onTime:time=>{
    if(disposed)return;engineTime=true;props.c.playhead.value=time;if(time>=props.c.total.value)props.c.playing.value=false;
    queueMicrotask(()=>{engineTime=false;});
  }});gpuError.value='';}
  catch(e){gpuError.value='实时预览不可用：'+(e as Error).message;props.c.setRealtimePreviewAvailable(false);}
}
async function updateDocument(){
  const current=++epoch,document=props.c.doc.value;
  if(mode.value!=='auto'||!document){engine?.pause();props.c.setRealtimePreviewAvailable(false);return;}
  if(!engine)createEngine();if(!engine)return;
  try{const result=await engine.setDocument(document,{diagnostics:props.c.state.value?.diagnostics,time:props.c.playhead.value,textContext:props.c.state.value?{projectId:props.c.state.value.id,revision:props.c.state.value.revision}:undefined});if(!disposed&&current===epoch)accept(result);}
  catch(e){if(current===epoch){gpuError.value='实时预览不可用：'+(e as Error).message;props.c.setRealtimePreviewAvailable(false);}}
}
function seekPlayer(value:number){if(player.value)player.value.currentTime=Math.min(value+Math.min(.0001,.1/rate.value),Math.max(0,(player.value.duration||0)-.0001));}
watch(()=>props.c.doc.value,()=>{void updateDocument();});
watch(mode,()=>{props.c.playing.value=false;void updateDocument();});
watch(()=>props.c.playing.value,async playing=>{
  if(realtime.value&&engine){if(playing)await engine.play(props.c.playhead.value);else engine.pause();return;}
  if(!player.value)return;if(playing&&renderedReady.value){try{await player.value.play();}catch{props.c.playing.value=false;}}else player.value.pause();
});
watch(()=>props.c.playhead.value,value=>{
  if(engineTime)return;
  if(realtime.value&&engine){if(!props.c.playing.value)void engine.seek(value).then(accept);return;}
  const tolerance=props.c.playing.value?.08:.000001;if(player.value&&Math.abs(player.value.currentTime-value)>tolerance)seekPlayer(value);
});
watch(realtime,value=>{if(value)player.value?.pause();else engine?.pause();});
function loaded(){seekPlayer(props.c.playhead.value);}
function update(){if(player.value&&props.c.playing.value&&!realtime.value)props.c.playhead.value=player.value.currentTime;}
function step(delta:number){props.c.playing.value=false;props.c.seek(props.c.playhead.value+delta/rate.value);}
async function sampleColors(){props.c.playing.value=false;if(engine&&realtime.value&&canvas.value)try{const {width,height}=canvas.value;const points=[[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>({x:Math.floor(width*x),y:Math.floor(height*y)}));colorDiagnostic.value=await engine.diagnoseColor(points,true);}catch(e){props.c.report(e);}}
function retry(){props.c.playing.value=false;if(mode.value==='rendered'){props.c.schedulePreview();return;}engine?.dispose();engine=undefined;manifest.value=undefined;gpuError.value='';void updateDocument();}
onMounted(()=>{void updateDocument();});
onBeforeUnmount(()=>{disposed=true;epoch++;engine?.dispose({releaseContext:true});props.c.setRealtimePreviewAvailable(false);if(player.value){player.value.pause();player.value.removeAttribute('src');player.value.load();}});
</script>
<template>
  <section class="preview-panel panel">
    <header class="panel-heading"><span>播放器</span><div class="preview-controls"><button class="preview-backend" aria-label="预览性能详情" @click="details=!details">{{backendLabel}}</button><select v-model="mode" aria-label="预览方式"><option value="auto">自动实时</option><option value="rendered">后台精确预览</option></select><a-tooltip title="重新加载预览"><button class="icon-button" aria-label="重新生成预览" :disabled="c.readOnly.value||!c.total.value" @click="retry"><Icon name="reload" /></button></a-tooltip></div></header>
    <div class="preview-stage" :class="{updating:waiting}" :data-preview-backend="realtime?'webgl2':'rendered'" :data-preview-state="manifest?.state" :data-preview-renderer="manifest?.renderer.renderer" :data-preview-metrics="manifest?JSON.stringify(manifest.metrics):''" :data-preview-diagnostic="colorDiagnostic?JSON.stringify(colorDiagnostic):''">
      <canvas v-show="realtime" ref="canvas" aria-label="实时视频画面" @click="ready&&(c.playing.value=!c.playing.value)" />
      <video v-show="!realtime" v-if="source" ref="player" :src="source" preload="auto" playsinline @loadedmetadata="loaded" @timeupdate="update" @ended="c.playing.value=false" @click="ready&&(c.playing.value=!c.playing.value)" />
      <div v-if="!realtime&&!source" class="preview-empty"><Icon name="video" /><span>{{c.readOnly.value?'此草稿暂不支持预览':c.total.value?'正在准备预览':'将素材添加到时间线开始剪辑'}}</span></div>
      <div v-if="waiting" class="preview-updating"><a-spin size="small" /><span>{{realtime?'正在准备画面与音轨':'正在更新预览'}}</span></div>
      <div v-if="details" class="preview-performance"><strong>{{backendLabel}}</strong><span v-if="manifest&&realtime">{{manifest.renderer.renderer}}</span><span v-if="manifest&&realtime">合成 {{manifest.metrics.meanCpuMs.toFixed(2)}} ms · 定位 {{manifest.metrics.lastDecodeWaitMs.toFixed(1)}} ms · 掉帧 输出 {{manifest.metrics.droppedOutputFrames}} / 解码 {{manifest.metrics.decoderDroppedFrames}}</span><span v-if="!realtime">{{reason||'按当前工程修订生成后台预览。'}}</span><button v-if="realtime" class="text-link" aria-label="采样预览颜色" @click="sampleColors">颜色诊断</button><span v-if="colorDiagnostic">已记录第 {{colorDiagnostic.frame}} 帧的画布与源颜色</span></div>
      <span v-if="c.doc.value" class="preview-size">{{c.doc.value.canvas.width}} × {{c.doc.value.canvas.height}}</span>
    </div>
    <div class="player-transport"><div class="player-time"><strong>{{timecode(c.playhead.value,rate)}}</strong><span> / {{timecode(c.total.value,rate)}}</span></div><div class="player-buttons"><button class="icon-button" aria-label="上一帧" :disabled="!ready" @click="step(-1)"><Icon name="previous" /></button><button class="play-button" :aria-label="c.playing.value?'暂停':'播放'" :disabled="!ready" @click="c.playing.value=!c.playing.value"><Icon :name="c.playing.value?'pause':'play'" /></button><button class="icon-button" aria-label="下一帧" :disabled="!ready" @click="step(1)"><Icon name="next" /></button></div><span class="preview-fit">适应 <Icon name="down" /></span></div>
  </section>
</template>
