<script setup lang="ts">
import {computed,reactive,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import {decimal,toNumber} from '../../../../packages/core/src/time.ts';
import {canRenderTextAnimationText} from '../../../../packages/core/src/text-animation.ts';
import type {TextAnimation} from '../../../../packages/core/src/text-animation.ts';
const props=defineProps<{c:EditorController}>();
const selected=computed(()=>props.c.selected.value),clip=computed(()=>selected.value?.clip);
const draft=reactive({entrance:'none',exit:'none',inSeconds:.5,outSeconds:.5});
const disabled=computed(()=>!clip.value||props.c.readOnly.value||props.c.busy.value||!!selected.value?.track.locked);
const valid=computed(()=>Number.isFinite(draft.inSeconds)&&Number.isFinite(draft.outSeconds)&&
 (draft.entrance==='none'||draft.inSeconds>0)&&(draft.exit==='none'||draft.outSeconds>0)&&
 (draft.entrance==='none'?0:draft.inSeconds)+(draft.exit==='none'?0:draft.outSeconds)<=toNumber(clip.value?.target.duration||decimal('0'))&&
 (draft.entrance!=='typewriter'||canRenderTextAnimationText(clip.value?.text?.content||'')));
watch(()=>[props.c.state.value?.id,props.c.state.value?.revision,props.c.selectedId.value],()=>{
 const animations=clip.value?.textAnimations||[],entrance=animations.find(a=>a.phase==='in'),exit=animations.find(a=>a.phase==='out');
 draft.entrance=entrance?.kind||'none';draft.exit=exit?.kind||'none';
 draft.inSeconds=entrance?toNumber(entrance.duration):Math.min(.5,toNumber(clip.value?.target.duration||decimal('0.5')));
 draft.outSeconds=exit?toNumber(exit.duration):Math.min(.5,toNumber(clip.value?.target.duration||decimal('0.5')));
},{immediate:true});
function apply(){if(disabled.value||!valid.value||!clip.value)return;const animations:TextAnimation[]=[];
 if(draft.entrance!=='none')animations.push({phase:'in',kind:draft.entrance as 'fade'|'typewriter',duration:decimal(String(draft.inSeconds))});
 if(draft.exit!=='none')animations.push({phase:'out',kind:'fade',duration:decimal(String(draft.outSeconds))});
 return props.c.guard(()=>props.c.edit({type:'clip.update',clipId:clip.value!.id,changes:{textAnimations:animations}}));
}
function remove(){if(!disabled.value&&clip.value)return props.c.guard(()=>props.c.edit({type:'clip.update',clipId:clip.value!.id,changes:{textAnimations:[]}}));}
</script>
<template>
 <div class="inspector-section text-animation-controls"><header><strong>文字动画</strong><a-button size="small" :disabled="disabled||!clip?.textAnimations?.length" @click="remove">移除动画</a-button></header>
  <div class="control-row"><span>入场</span><a-select v-model:value="draft.entrance" aria-label="文字入场动画" :disabled="disabled" :options="[{value:'none',label:'无'},{value:'fade',label:'渐显'},{value:'typewriter',label:'打字机 I'}]" /></div>
  <div v-if="draft.entrance!=='none'" class="control-row"><span>动画时长</span><a-input-number v-model:value="draft.inSeconds" aria-label="文字入场时长秒" :disabled="disabled" :min=".001" :max="clip?toNumber(clip.target.duration):1" :precision="6" :step=".1" /><small>秒</small></div>
  <div class="control-row"><span>出场</span><a-select v-model:value="draft.exit" aria-label="文字出场动画" :disabled="disabled" :options="[{value:'none',label:'无'},{value:'fade',label:'渐隐'}]" /></div>
  <div v-if="draft.exit!=='none'" class="control-row"><span>动画时长</span><a-input-number v-model:value="draft.outSeconds" aria-label="文字出场时长秒" :disabled="disabled" :min=".001" :max="clip?toNumber(clip.target.duration):1" :precision="6" :step=".1" /><small>秒</small></div>
  <p v-if="draft.entrance==='typewriter'&&!canRenderTextAnimationText(clip?.text?.content||'')" class="quiet">当前打字机支持常用汉字、英文、空格和换行；此文字含暂未支持的字形。</p>
  <p v-if="!valid" class="quiet">请检查动画时长，入场与出场总时长不能超过片段。</p>
  <a-button size="small" :disabled="disabled||!valid" @click="apply">应用文字动画</a-button>
 </div>
</template>
