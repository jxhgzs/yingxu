<script setup lang="ts">
import {computed,reactive,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import type {Transition} from '../../../../packages/core/src/document.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';
import {buildTransitionCandidate,transitionDurationFromInput} from '../transition-candidate.ts';
import {transitionPresentation} from '../transition-presentation.ts';
const props=defineProps<{c:EditorController}>();
const durations=reactive<Record<string,number>>({});
const selected=computed(()=>props.c.selected.value);
const related=computed(()=>props.c.doc.value?.transitions?.filter(t=>[t.outgoingClipId,t.incomingClipId].includes(selected.value?.clip.id||''))||[]);
const disabled=computed(()=>props.c.readOnly.value||props.c.busy.value||!!selected.value?.track.locked);
watch(()=>props.c.state.value?.revision,()=>{for(const t of related.value)durations[t.id]=toNumber(t.duration);},{immediate:true});
watch(()=>props.c.selectedId.value,()=>{for(const t of related.value)durations[t.id]=toNumber(t.duration);});
const options=(Object.entries(transitionPresentation) as [Transition['kind'],{name:string;icon:string}][]).map(([kind,presentation])=>({kind,...presentation}));
const candidates=computed(()=>options.map(option=>{const value=buildTransitionCandidate(props.c.doc.value,selected.value?.track.id,selected.value?.clip.id,option.kind);return {...value,...option,incomingName:value.name};}));
async function addTransition(kind:Transition['kind']){const value=candidates.value.find(v=>v.kind===kind);if(value?.transition&&!disabled.value)await props.c.guard(()=>props.c.edit({type:'transition.add',transition:{...value.transition!,id:crypto.randomUUID()}}));}
function update(t:Transition){if(!disabled.value)void props.c.guard(()=>props.c.edit({type:'transition.update',transitionId:t.id,changes:{duration:transitionDurationFromInput(t,durations[t.id])}}));}
</script>
<template>
 <div class="inspector-section transition-editor"><header><strong>转场</strong></header>
  <p class="quiet">转场在剪辑点两侧居中播放，工程总时长保持不变。</p>
  <div v-for="transition in related" :key="transition.id" class="transition-card"><select :value="transition.kind" aria-label="转场类型" :disabled="disabled" @change="c.guard(()=>c.edit({type:'transition.update',transitionId:transition.id,changes:{kind:($event.target as HTMLSelectElement).value as Transition['kind']}}))"><option v-for="option in options" :key="option.kind" :value="option.kind">{{option.name}}</option></select><div class="control-row"><span>持续时间</span><a-input-number v-model:value="durations[transition.id]" :aria-label="'转场秒 '+transition.id" :min="c.doc.value?1/toNumber(c.doc.value.fps):0.033334" :precision="6" :step="0.1" :disabled="disabled"/><small>秒</small></div><div class="transition-actions"><a-button size="small" :disabled="disabled" @click="update(transition)">应用时长</a-button><a-button size="small" danger :disabled="disabled" @click="c.guard(()=>c.edit({type:'transition.remove',transitionId:transition.id}))">删除转场</a-button></div></div>
  <template v-for="candidate in candidates" :key="candidate.kind"><div v-if="candidate.transition" class="transition-option"><span class="transition-icon">{{candidate.icon}}</span><span>{{candidate.name}}<small>接入 {{candidate.incomingName}}</small></span><a-button size="small" :disabled="disabled" @click="addTransition(candidate.kind)">添加{{candidate.name}}</a-button></div><p v-else-if="candidate.kind==='crossfade'" class="quiet">{{candidate.reason}}</p></template>
 </div>
</template>
