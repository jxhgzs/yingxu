<script setup lang="ts">
import {ref,shallowRef,computed,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import {parseSubtitles,SubtitleParseError,SUBTITLE_LIMITS} from '../../../../packages/core/src/subtitles.ts';
import type {SubtitleFormat,ParsedSubtitles} from '../../../../packages/core/src/subtitles.ts';
import {applySubtitleImport} from '../../../../packages/core/src/subtitle-import.ts';
import {decimal,toNumber,add} from '../../../../packages/core/src/time.ts';
const props=defineProps<{c:EditorController;open:boolean}>(),emit=defineEmits<{'update:open':[boolean]}>();
const chooser=ref<HTMLInputElement>(),parsed=shallowRef<ParsedSubtitles>(),name=ref(''),offset=ref(0),error=ref(''),reading=ref(false),submitting=ref(false),prefix=ref(''),projectId=ref('');
let generation=0;
watch(()=>props.open,open=>{generation++;if(open){parsed.value=undefined;name.value='';offset.value=0;error.value='';prefix.value=crypto.randomUUID();projectId.value=props.c.state.value?.id||'';}else reading.value=false;});
function explain(e:unknown){if(e instanceof SubtitleParseError)return `字幕${e.line?'第 '+e.line+' 行':''}无法导入：${e.code.includes('UNSUPPORTED')?'此文件含尚未支持的格式、布局或时间标记。':'请检查时间、文字及文件格式。'}`;return e instanceof Error?e.message:String(e);}
async function choose(event:Event){
 const el=event.target as HTMLInputElement,file=el.files?.[0];el.value='';if(!file)return;const token=++generation;reading.value=true;error.value='';parsed.value=undefined;
 try{if(file.size>SUBTITLE_LIMITS.bytes)throw Error('字幕文件不能超过4MB。');const ext=file.name.split('.').at(-1)?.toLowerCase();if(ext!=='srt'&&ext!=='vtt')throw Error('请选择SRT或WebVTT文件。');const input=await file.text();if(token!==generation)return;parsed.value=parseSubtitles(input,ext as SubtitleFormat);name.value=file.name.slice(0,90);}catch(e){if(token===generation)error.value=explain(e);}finally{if(token===generation)reading.value=false;}
}
const options=computed(()=>({idPrefix:prefix.value,name:name.value,offset:decimal(String(offset.value))}));
const cueRange=computed(()=>parsed.value?{start:Math.min(...parsed.value.cues.map(c=>toNumber(c.start)))+offset.value,end:Math.max(...parsed.value.cues.map(c=>toNumber(add(c.start,c.duration))))+offset.value}:null);
const preview=computed(()=>{if(submitting.value||!parsed.value||!props.c.doc.value)return null;try{return {value:applySubtitleImport(props.c.doc.value,parsed.value,options.value),error:''};}catch(e){return {value:null,error:explain(e)};}});
const warnings=computed(()=>[...new Set(preview.value?.value?.diagnostics.filter(d=>d.severity==='warning').map(d=>d.message)||[])]);
async function submit(){if(!parsed.value||!preview.value?.value)return;submitting.value=true;try{if(projectId.value!==props.c.state.value?.id)throw Error('PROJECT_CHANGED');await props.c.edit({type:'subtitles.import',input:parsed.value.sourceText,format:parsed.value.format,options:options.value});emit('update:open',false);}catch(e){props.c.report(e);}finally{submitting.value=false;}}
</script>
<template>
 <a-modal :open="open" title="导入字幕" :width="600" :footer="null" :get-container="false" @cancel="emit('update:open',false)">
  <p class="quiet">支持SRT、WebVTT；导入为可编辑的普通文字片段，原始字幕随工程保留。</p>
  <a-button :loading="reading" :disabled="submitting" @click="chooser?.click()">选择字幕文件</a-button><input ref="chooser" type="file" accept=".srt,.vtt" hidden @change="choose"/>
  <a-alert v-if="error" style="margin-top:16px" type="error" :message="error" show-icon/>
  <template v-if="parsed">
   <p>{{name}} · {{parsed.cues.length}} 条字幕 · {{cueRange?.start.toFixed(3)}}—{{cueRange?.end.toFixed(3)}} 秒</p><label class="subtitle-offset">时间偏移（秒）<a-input-number v-model:value="offset" aria-label="字幕时间偏移" :min="0" :precision="3" :step="0.1" :disabled="submitting"/></label>
   <a-alert v-for="warning in warnings" :key="warning" style="margin-top:12px" type="warning" :message="warning" show-icon/>
   <a-alert v-if="preview?.error" style="margin-top:12px" type="error" :message="preview.error" show-icon/>
   <div class="subtitle-cue-preview"><article v-for="cue in parsed.cues.slice(0,4)" :key="cue.index"><small>{{(toNumber(cue.start)+offset).toFixed(3)}}—{{(toNumber(add(cue.start,cue.duration))+offset).toFixed(3)}} 秒</small><p>{{cue.text}}</p></article><p v-if="parsed.cues.length>4" class="quiet">其余 {{parsed.cues.length-4}} 条将在时间线显示</p></div>
  </template>
  <div class="modal-actions"><a-button @click="emit('update:open',false)">取消</a-button><a-button type="primary" :loading="submitting" :disabled="!preview?.value||reading||c.readOnly.value||c.busy.value||projectId!==c.state.value?.id" @click="submit">导入字幕</a-button></div>
 </a-modal>
</template>
