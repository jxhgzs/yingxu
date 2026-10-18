<script setup lang="ts">
import {ref, computed, watch} from 'vue';
import type {EditorController} from '../controller.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';
import Icon from './Icon.vue';
const props=defineProps<{c:EditorController;open:boolean}>();
const emit=defineEmits<{'update:open':[boolean]}>();
const name=ref(''),jobId=ref<string|null>(null),submitting=ref(false);
const job=computed(()=>props.c.jobs.value.find(j=>j.id===jobId.value));
const active=computed(()=>submitting.value||!!job.value&&['running','queued','cancelling'].includes(job.value.status));
const completed=computed(()=>job.value?.status==='completed'&&job.value.result);
watch(()=>props.open,open=>{if(open){name.value=props.c.doc.value?.title||'映序导出';jobId.value=null;}});
async function start(){submitting.value=true;try{const result=await props.c.exportVideo();if(result)jobId.value=result.id;}catch(e){props.c.report(e);}finally{submitting.value=false;}}
const status=computed(()=>({queued:'等待导出',running:'正在导出',cancelling:'正在取消',cancelled:'已取消',failed:'导出失败',interrupted:'任务已中断',completed:'导出完成'}[job.value?.status||'']));
</script>
<template>
  <a-modal :open="open" title="导出视频" :footer="null" :width="540" :get-container="false" @cancel="emit('update:open',false)">
    <div v-if="completed" class="export-complete"><Icon name="saved" /><h3>导出完成</h3><p>{{completed.width}} × {{completed.height}} · {{completed.frameCount}} 帧 · {{completed.duration.toFixed(3)}} 秒</p><a-button type="primary" :href="c.api.url(completed.downloadUrl)+'?name='+encodeURIComponent(name+'.mp4')"><Icon name="export" />下载视频</a-button><a-button :href="c.api.url(completed.url)" target="_blank">查看成片</a-button></div>
    <div v-else class="export-form">
      <label>文件名<a-input v-model:value="name" aria-label="导出文件名" :disabled="active" :maxlength="180" suffix=".mp4" /></label>
      <dl class="export-settings"><dt>分辨率</dt><dd>{{c.doc.value?.canvas.width}} × {{c.doc.value?.canvas.height}}</dd><dt>帧率</dt><dd>{{c.doc.value?toNumber(c.doc.value.fps).toFixed(2):'30'}} fps</dd><dt>格式</dt><dd>MP4 · H.264 / AAC</dd><dt>时长</dt><dd>{{c.total.value.toFixed(3)}} 秒</dd></dl>
      <template v-if="job"><div class="export-progress-label"><span>{{status}}</span><span>{{Math.round(job.progress*100)}}%</span></div><a-progress :percent="Math.round(job.progress*100)" :show-info="false" :status="job.status==='failed'?'exception':undefined" /><p v-if="job.error" class="export-error">{{job.status==='cancelled'?'本次导出已取消':job.error.slice(0,500)}}</p></template>
      <div class="modal-actions"><a-button v-if="active&&job" @click="c.guard(()=>c.api.post('/api/jobs/'+job!.id+'/cancel'))">取消任务</a-button><a-button @click="emit('update:open',false)">{{active?'后台继续':'取消'}}</a-button><a-button type="primary" :loading="active" :disabled="!c.total.value||c.readOnly.value||c.busy.value||!name.trim()" @click="start"><Icon name="export" />{{active?'正在导出':'导出'}}</a-button></div>
    </div>
  </a-modal>
</template>
