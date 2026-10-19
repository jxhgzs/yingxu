<script setup lang="ts">
import {reactive,computed,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import {normalizeColorAdjustments} from '../../../../packages/core/src/color-effects.ts';
const props=defineProps<{c:EditorController}>();
const controls=[{key:'brightness',label:'亮度'},{key:'contrast',label:'对比度'},{key:'saturation',label:'饱和度'},{key:'highlight',label:'高光'},{key:'shadow',label:'阴影'}] as const;
const draft=reactive({brightness:0,contrast:0,saturation:0,highlight:0,shadow:0});
const selected=computed(()=>props.c.selected.value),supported=computed(()=>selected.value&&['video','image'].includes(selected.value.asset.kind||'video'));
const disabled=computed(()=>!supported.value||props.c.busy.value||props.c.readOnly.value||!!selected.value?.track.locked);
watch(()=>[props.c.state.value?.revision,props.c.selectedId.value],()=>{const values=normalizeColorAdjustments(selected.value?.clip.colorAdjustments);for(const {key}of controls)draft[key]=values[key]*50;},{immediate:true});
function apply(){if(!disabled.value)return props.c.guard(()=>props.c.edit({type:'clip.update',clipId:selected.value!.clip.id,changes:{colorAdjustments:{version:'combine-adjust-v2',brightness:draft.brightness/50,contrast:draft.contrast/50,saturation:draft.saturation/50,highlight:draft.highlight/50,shadow:draft.shadow/50}}}));}
function reset(){for(const {key}of controls)draft[key]=0;void apply();}
</script>
<template>
 <div class="inspector-section color-adjustments"><header><strong>基础调节</strong><a-button size="small" :disabled="disabled" @click="reset">重置调节</a-button></header>
  <p v-if="!supported" class="quiet">请选择视频或图片片段。</p>
  <template v-else><div v-for="control in controls" :key="control.key" class="control-row"><span>{{control.label}}</span><a-slider v-model:value="draft[control.key]" :min="-50" :max="50" :step="1" :disabled="disabled" @after-change="apply"/><a-input-number v-model:value="draft[control.key]" :aria-label="control.label+'调节'" :min="-50" :max="50" :precision="2" :disabled="disabled" @pressEnter="apply"/></div><a-button size="small" :disabled="disabled" @click="apply">应用调节</a-button></template>
 </div>
</template>
