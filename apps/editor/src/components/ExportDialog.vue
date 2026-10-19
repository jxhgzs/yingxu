<script setup lang="ts">
import {ref,computed,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import {decimal,rational,sub,toNumber} from '../../../../packages/core/src/time.ts';
import {duration} from '../../../../packages/core/src/document.ts';
import {resolveExportSettings} from '../../../../packages/core/src/export.ts';
import type {ExportSettings,ExportFormat} from '../../../../packages/core/src/export.ts';
import Icon from './Icon.vue';
const props=defineProps<{c:EditorController;open:boolean}>(),emit=defineEmits<{'update:open':[boolean]}>();
const name=ref(''),jobId=ref<string|null>(null),submitting=ref(false),format=ref<ExportFormat>('mp4');
const height=ref(0),fps=ref(0),codec=ref<'h264'|'hevc'>('h264'),videoRate=ref<number|null>(null),sampleRate=ref<44100|48000>(44100),audioRate=ref(192);
const range=ref('all'),startTime=ref(0),endTime=ref(0),audioOnly=computed(()=>['mp3','wav','m4a'].includes(format.value));
const job=computed(()=>props.c.jobs.value.find(j=>j.id===jobId.value));
const active=computed(()=>submitting.value||!!job.value&&['running','queued','cancelling'].includes(job.value.status));
const completed=computed(()=>job.value?.status==='completed'&&job.value.result);
const sizes=computed(()=>{const canvas=props.c.doc.value?.canvas;if(!canvas)return [];return [{value:0,label:`工程原尺寸（${canvas.width} × ${canvas.height}）`},...[240,360,480,720,1080,1440,2160].map(h=>({value:h,label:`${h}p（${Math.max(2,Math.round(h*canvas.width/canvas.height/2)*2)} × ${h}）`}))];});
watch(()=>props.open,open=>{if(open){name.value=props.c.doc.value?.title||'映序导出';jobId.value=null;endTime.value=props.c.total.value;}});
watch(format,()=>{height.value=format.value==='gif'?240:0;fps.value=format.value==='gif'?10:0;audioRate.value=format.value==='mp3'?128:192;});
const settings=computed<ExportSettings>(()=>{
 const doc=props.c.doc.value;if(!doc)return {};const selected:ExportSettings={format:format.value};
 if(!audioOnly.value){if(height.value)selected.size={width:Math.max(2,Math.round(height.value*doc.canvas.width/doc.canvas.height/2)*2),height:height.value};if(fps.value)selected.fps=rational(fps.value);if(format.value!=='gif'){selected.videoCodec=codec.value;if(videoRate.value)selected.videoBitrateKbps=videoRate.value;}}
 if(format.value!=='gif'){selected.audioSampleRate=sampleRate.value;if(format.value!=='wav')selected.audioBitrateKbps=audioRate.value;}
 if(range.value==='custom'){const start=decimal(String(startTime.value)),end=endTime.value===props.c.total.value?duration(doc):decimal(String(endTime.value));selected.range={start,duration:sub(end,start)};}return selected;
});
const resolved=computed(()=>{try{return props.c.doc.value?resolveExportSettings(props.c.doc.value,settings.value):null;}catch{return null;}});
const frameOptions=computed(()=>format.value==='gif'?[5,10,20,25,50].map(value=>({value,label:value+' fps'})):[{value:0,label:'跟随工程（'+(props.c.doc.value?toNumber(props.c.doc.value.fps).toFixed(2):30)+' fps）'},...[24,25,30,50,60].map(value=>({value,label:value+' fps'}))]);
async function start(){submitting.value=true;try{const result=await props.c.exportVideo(settings.value);if(result)jobId.value=result.id;}catch(e){props.c.report(e);}finally{submitting.value=false;}}
const status=computed(()=>({queued:'等待导出',running:'正在导出',cancelling:'正在取消',cancelled:'已取消',failed:'导出失败',interrupted:'任务已中断',completed:'导出完成'}[job.value?.status||'']));
</script>
<template>
 <a-modal :open="open" title="导出" :footer="null" :width="560" :get-container="false" @cancel="emit('update:open',false)">
  <div v-if="completed" class="export-complete"><Icon name="saved"/><h3>导出完成</h3><p>{{(completed.format||'mp4').toUpperCase()}} · <template v-if="completed.width">{{completed.width}} × {{completed.height}} · {{completed.frameCount}} 帧 · </template>{{completed.duration.toFixed(3)}} 秒</p><a-button type="primary" :href="c.api.url(completed.downloadUrl)+'?name='+encodeURIComponent(name+'.'+(completed.extension||'mp4'))"><Icon name="export"/>下载成果</a-button><a-button :href="c.api.url(completed.url)" target="_blank">查看成果</a-button></div>
  <div v-else class="export-form">
   <label>文件名<a-input v-model:value="name" aria-label="导出文件名" :disabled="active" :maxlength="180" :suffix="'.'+format"/></label>
   <div class="export-controls">
    <label>格式<a-select v-model:value="format" aria-label="导出格式" :disabled="active" :options="['mp4','mov','gif','mp3','wav','m4a'].map(value=>({value,label:value.toUpperCase()}))"/></label>
    <template v-if="!audioOnly">
     <label>分辨率<a-select v-model:value="height" aria-label="导出分辨率" :disabled="active" :options="sizes"/></label>
     <label>帧率<a-select v-model:value="fps" aria-label="导出帧率" :disabled="active" :options="frameOptions"/></label>
     <template v-if="format!=='gif'"><label>视频编码<a-select v-model:value="codec" aria-label="视频编码" :disabled="active" :options="[{value:'h264',label:'H.264'},{value:'hevc',label:'HEVC（H.265）'}]"/></label><label>视频码率（kbps）<a-input-number v-model:value="videoRate" aria-label="视频码率" placeholder="自动" :min="100" :max="200000" :precision="0" :disabled="active"/></label></template>
    </template>
    <template v-if="format!=='gif'"><label>音频采样率<a-select v-model:value="sampleRate" aria-label="音频采样率" :disabled="active" :options="[{value:44100,label:'44.1 kHz'},{value:48000,label:'48 kHz'}]"/></label><label v-if="format!=='wav'">音频码率<a-select v-model:value="audioRate" aria-label="音频码率" :disabled="active" :options="[64,96,128,160,192,256,320].map(value=>({value,label:value+' kbps'}))"/></label><p v-else class="quiet">WAV · PCM 16 位</p></template>
    <label>导出范围<a-select v-model:value="range" aria-label="导出范围" :disabled="active" :options="[{value:'all',label:'整个工程'},{value:'custom',label:'指定时间区间'}]"/></label>
    <template v-if="range==='custom'"><label>开始（秒）<a-input-number v-model:value="startTime" aria-label="导出开始时间" :min="0" :max="c.total.value" :step="0.1" :disabled="active"/></label><label>结束（秒）<a-input-number v-model:value="endTime" aria-label="导出结束时间" :min="0" :max="c.total.value" :step="0.1" :disabled="active"/></label></template>
   </div>
   <p v-if="resolved" class="quiet">{{resolved.duration.toFixed(3)}} 秒<template v-if="!audioOnly"> · {{resolved.frameCount}} 帧 · {{resolved.width}} × {{resolved.height}}</template></p><p v-else class="export-error">请选择有效的导出设置和时间区间。</p>
   <template v-if="job"><div class="export-progress-label"><span>{{status}}</span><span>{{Math.round(job.progress*100)}}%</span></div><a-progress :percent="Math.round(job.progress*100)" :show-info="false" :status="job.status==='failed'?'exception':undefined"/><p v-if="job.error" class="export-error">{{job.status==='cancelled'?'本次导出已取消':job.error.slice(0,500)}}</p></template>
   <div class="modal-actions"><a-button v-if="active&&job" @click="c.guard(()=>c.api.post('/api/jobs/'+job!.id+'/cancel'))">取消任务</a-button><a-button @click="emit('update:open',false)">{{active?'后台继续':'取消'}}</a-button><a-button type="primary" :loading="active" :disabled="!resolved||c.readOnly.value||c.busy.value||!name.trim()" @click="start"><Icon name="export"/>{{active?'正在导出':'导出'}}</a-button></div>
  </div>
 </a-modal>
</template>
