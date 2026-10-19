<script setup lang="ts">
import {computed,reactive,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import type {Transition} from '../../../../packages/core/src/document.ts';
import {validateDocument} from '../../../../packages/core/src/document.ts';
import {toNumber,decimal,add,compare} from '../../../../packages/core/src/time.ts';
const props=defineProps<{c:EditorController}>();
const durations=reactive<Record<string,number>>({});
const selected=computed(()=>props.c.selected.value);
const related=computed(()=>props.c.doc.value?.transitions?.filter(t=>[t.outgoingClipId,t.incomingClipId].includes(selected.value?.clip.id||''))||[]);
const disabled=computed(()=>props.c.readOnly.value||props.c.busy.value||!!selected.value?.track.locked);
watch(()=>props.c.state.value?.revision,()=>{for(const t of related.value)durations[t.id]=toNumber(t.duration);},{immediate:true});
watch(()=>props.c.selectedId.value,()=>{for(const t of related.value)durations[t.id]=toNumber(t.duration);});
function buildCandidate(kind:Transition['kind']){
 const item=selected.value,doc=props.c.doc.value;if(!item||!doc||item.track.kind!=='video')return {reason:'请选择视频片段。'};
 const ordered=[...item.track.clips].sort((a,b)=>compare(a.target.start,b.target.start)),index=ordered.findIndex(c=>c.id===item.clip.id),next=ordered[index+1];
 if(!next||compare(add(item.clip.target.start,item.clip.target.duration),next.target.start)!==0)return {reason:'所选片段后方需要紧邻另一段视频。'};
 if(doc.transitions?.some(t=>t.outgoingClipId===item.clip.id))return {reason:'此剪辑点已有转场。'};
 const remaining=toNumber(item.asset.duration)-toNumber(add(item.clip.source.start,item.clip.source.duration));
 const max=Math.min(toNumber(item.clip.target.duration)/2,toNumber(next.target.duration)/2,...(kind==='crossfade'?[remaining*2/toNumber(item.clip.speed),toNumber(next.source.start)*2/toNumber(next.speed)]:[]));
 if(max<1/toNumber(doc.fps))return {reason:'转场两侧需要保留足够的源素材，请先调整采用区间。'};
 const transition:Transition={id:'transition-candidate',trackId:item.track.id,outgoingClipId:item.clip.id,incomingClipId:next.id,kind,alignment:'center',overlap:kind==='crossfade',duration:decimal(Math.min(.5,max).toFixed(6))};
 try{validateDocument({...doc,transitions:[...(doc.transitions||[]),transition]});}catch{return {reason:'此剪辑点暂不支持添加转场，请检查变速、素材和已有转场。'};}
 return {transition,name:doc.assets.find(a=>a.id===next.materialId)?.name||'下一片段'};
}
const candidate=computed(()=>buildCandidate('crossfade')),blackCandidate=computed(()=>buildCandidate('dipToBlack'));
async function addTransition(kind:Transition['kind']){const value=kind==='crossfade'?candidate.value:blackCandidate.value;if(value.transition&&!disabled.value)await props.c.guard(()=>props.c.edit({type:'transition.add',transition:{...value.transition!,id:crypto.randomUUID()}}));}
function update(t:Transition){if(!disabled.value)void props.c.guard(()=>props.c.edit({type:'transition.update',transitionId:t.id,changes:{duration:decimal(String(durations[t.id]))}}));}
</script>
<template>
 <div class="inspector-section transition-editor"><header><strong>转场</strong></header>
  <p class="quiet">转场在剪辑点两侧居中播放，工程总时长保持不变。</p>
  <div v-for="transition in related" :key="transition.id" class="transition-card"><select :value="transition.kind" aria-label="转场类型" :disabled="disabled" @change="c.guard(()=>c.edit({type:'transition.update',transitionId:transition.id,changes:{kind:($event.target as HTMLSelectElement).value as Transition['kind']}}))"><option value="crossfade">叠化</option><option value="dipToBlack">闪黑</option></select><div class="control-row"><span>持续时间</span><a-input-number v-model:value="durations[transition.id]" :aria-label="'转场秒 '+transition.id" :min="c.doc.value?1/toNumber(c.doc.value.fps):0.033334" :precision="6" :step="0.1" :disabled="disabled"/><small>秒</small></div><div class="transition-actions"><a-button size="small" :disabled="disabled" @click="update(transition)">应用时长</a-button><a-button size="small" danger :disabled="disabled" @click="c.guard(()=>c.edit({type:'transition.remove',transitionId:transition.id}))">删除转场</a-button></div></div>
  <template v-if="candidate.transition"><div class="transition-option"><span class="transition-icon">◩</span><span>叠化<small>接入 {{candidate.name}}</small></span><a-button size="small" :disabled="disabled" @click="addTransition('crossfade')">添加叠化</a-button></div></template><p v-else class="quiet">{{candidate.reason}}</p>
  <div v-if="blackCandidate.transition" class="transition-option"><span class="transition-icon">◼</span><span>闪黑<small>接入 {{blackCandidate.name}}</small></span><a-button size="small" :disabled="disabled" @click="addTransition('dipToBlack')">添加闪黑</a-button></div>
 </div>
</template>
