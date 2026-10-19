<script setup lang="ts">
import {computed,reactive,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import {decimal,toNumber} from '../../../../packages/core/src/time.ts';
import {canRenderTextAnimationText,validateTextAnimations} from '../../../../packages/core/src/text-animation.ts';
import type {TextAnimation} from '../../../../packages/core/src/text-animation.ts';
const props=defineProps<{c:EditorController}>();
const selected=computed(()=>props.c.selected.value),clip=computed(()=>selected.value?.clip);
const draft=reactive({entrance:'none',exit:'none',loop:'none',inSeconds:.5,outSeconds:.5,loopSeconds:.5});
const disabled=computed(()=>!clip.value||props.c.readOnly.value||props.c.busy.value||!!selected.value?.track.locked);
const loopMax=computed(()=>Math.max(0,toNumber(clip.value?.target.duration||decimal('0'))-(draft.entrance==='none'?0:draft.inSeconds)-(draft.exit==='none'?0:draft.outSeconds)));
const animations=computed<TextAnimation[]|undefined>(()=>{
 if(!clip.value)return;
 try{const values:TextAnimation[]=[];
  if(draft.entrance!=='none')values.push({phase:'in',kind:draft.entrance as 'fade'|'typewriter',duration:decimal(String(draft.inSeconds))});
  if(draft.exit!=='none')values.push({phase:'out',kind:'fade',duration:decimal(String(draft.outSeconds))});
  if(draft.loop!=='none')values.push({phase:'loop',kind:'flash',duration:decimal(String(draft.loopSeconds))});
  validateTextAnimations(values,clip.value.target.duration);return values;
 }catch{return undefined;}
});
const valid=computed(()=>!!animations.value&&(draft.entrance!=='typewriter'||canRenderTextAnimationText(clip.value?.text?.content||'')));
watch([()=>props.c.state.value?.id,()=>props.c.state.value?.revision,()=>props.c.selectedId.value],()=>{
 const animations=clip.value?.textAnimations||[],entrance=animations.find(a=>a.phase==='in'),exit=animations.find(a=>a.phase==='out'),loop=animations.find(a=>a.phase==='loop');
 draft.entrance=entrance?.kind||'none';draft.exit=exit?.kind||'none';draft.loop=loop?.kind||'none';
 draft.inSeconds=entrance?toNumber(entrance.duration):Math.min(.5,toNumber(clip.value?.target.duration||decimal('0.5')));
 draft.outSeconds=exit?toNumber(exit.duration):Math.min(.5,toNumber(clip.value?.target.duration||decimal('0.5')));
 draft.loopSeconds=loop?toNumber(loop.duration):Math.min(.5,toNumber(clip.value?.target.duration||decimal('0.5')));
},{immediate:true});
function apply(){if(disabled.value||!valid.value||!clip.value||!animations.value)return;
 return props.c.guard(()=>props.c.edit({type:'clip.update',clipId:clip.value!.id,changes:{textAnimations:animations.value!}}));
}
function remove(){if(!disabled.value&&clip.value)return props.c.guard(()=>props.c.edit({type:'clip.update',clipId:clip.value!.id,changes:{textAnimations:[]}}));}
</script>
<template>
 <div class="inspector-section text-animation-controls"><header><strong>文字动画</strong><a-button size="small" :disabled="disabled||!clip?.textAnimations?.length" @click="remove">移除动画</a-button></header>
  <div class="control-row"><span>入场</span><a-select v-model:value="draft.entrance" aria-label="文字入场动画" :disabled="disabled" :options="[{value:'none',label:'无'},{value:'fade',label:'渐显'},{value:'typewriter',label:'打字机 I'}]" /></div>
  <div v-if="draft.entrance!=='none'" class="control-row"><span>动画时长</span><a-input-number v-model:value="draft.inSeconds" aria-label="文字入场时长秒" :disabled="disabled" :min=".001" :max="clip?toNumber(clip.target.duration):1" :precision="6" :step=".1" /><small>秒</small></div>
  <div class="control-row"><span>出场</span><a-select v-model:value="draft.exit" aria-label="文字出场动画" :disabled="disabled" :options="[{value:'none',label:'无'},{value:'fade',label:'渐隐'}]" /></div>
  <div v-if="draft.exit!=='none'" class="control-row"><span>动画时长</span><a-input-number v-model:value="draft.outSeconds" aria-label="文字出场时长秒" :disabled="disabled" :min=".001" :max="clip?toNumber(clip.target.duration):1" :precision="6" :step=".1" /><small>秒</small></div>
  <div class="control-row"><span>循环</span><a-select v-model:value="draft.loop" aria-label="文字循环动画" :disabled="disabled" :options="[{value:'none',label:'无'},{value:'flash',label:'闪烁'}]" /></div>
  <div v-if="draft.loop!=='none'" class="control-row"><span>循环周期</span><a-input-number v-model:value="draft.loopSeconds" aria-label="文字循环周期秒" :disabled="disabled" :min=".1" :max="loopMax" :precision="6" :step=".1" /><small>秒</small></div>
  <p v-if="draft.entrance==='typewriter'&&!canRenderTextAnimationText(clip?.text?.content||'')" class="quiet">当前打字机支持常用汉字、英文、空格和换行；此文字含暂未支持的字形。</p>
  <p v-if="!valid" class="quiet">请检查动画时长：入场与出场总长不能超过片段；循环周期至少0.1秒，且不超过中间可用时长。</p>
  <a-button size="small" :disabled="disabled||!valid" @click="apply">应用文字动画</a-button>
 </div>
</template>
