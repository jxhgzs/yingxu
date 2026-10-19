<script setup lang="ts">
import {computed,ref,reactive,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import {atFrame,timecode} from '../controller.ts';
import {defaultTransform} from '../../../../packages/core/src/document.ts';
import {evaluateAnimation,sourceTimeAt,targetTimeAt,animationBounds,keyframeAtFrame} from '../../../../packages/core/src/animation.ts';
import type {AnimatedProperty,Keyframe} from '../../../../packages/core/src/animation.ts';
import {compare,toNumber,add} from '../../../../packages/core/src/time.ts';
const props=defineProps<{c:EditorController}>();
const property=ref<AnimatedProperty>('scale'),value=ref(100),values=reactive<Record<string,number>>({});
const labels:Record<AnimatedProperty,string>={x:'位置 X',y:'位置 Y',scale:'缩放',rotation:'旋转',opacity:'不透明度',volume:'音量'};
const selected=computed(()=>props.c.selected.value),clip=computed(()=>selected.value?.clip);
const percent=computed(()=>['scale','opacity','volume'].includes(property.value)),factor=computed(()=>percent.value?100:1);
const animation=computed(()=>clip.value?.animations?.find(a=>a.property===property.value));
const points=computed(()=>animation.value?.points||[]);
const options=computed(()=>(selected.value?.track.kind==='audio'?['volume']:selected.value?.asset.hasAudio?Object.keys(labels):Object.keys(labels).filter(p=>p!=='volume')).map(p=>({value:p,label:labels[p as AnimatedProperty]})));
const head=computed(()=>props.c.doc.value?atFrame(props.c.playhead.value,props.c.doc.value.fps):undefined);
const inside=computed(()=>!!clip.value&&!!head.value&&compare(head.value,clip.value.target.start)>=0&&compare(head.value,add(clip.value.target.start,clip.value.target.duration))<=0);
const disabled=computed(()=>props.c.busy.value||props.c.readOnly.value||selected.value?.track.locked);
const range=computed(()=>animationBounds[property.value].map(n=>n*factor.value));
const active=computed(()=>clip.value&&head.value?keyframeAtFrame(clip.value,property.value,head.value,props.c.doc.value!.fps):undefined);
watch(()=>[props.c.state.value?.revision,props.c.selectedId.value,props.c.playhead.value,property.value],()=>{
  if(!clip.value||!head.value)return;
  if(!options.value.some(p=>p.value===property.value)){property.value=options.value[0]?.value as AnimatedProperty||'scale';return;}
  const base=property.value==='volume'?clip.value.volume??1:(clip.value.transform||defaultTransform())[property.value];
  value.value=(animation.value?evaluateAnimation(animation.value,sourceTimeAt(clip.value,head.value)):base)*factor.value;
  for(const p of points.value)values[p.id]=p.value*factor.value;
},{immediate:true});
function set(){return props.c.guard(()=>props.c.edit(props.c.keyframeCommand(property.value,value.value/factor.value)));}
function update(point:Keyframe,interpolation=point.interpolation){return props.c.guard(()=>props.c.edit({type:'keyframe.set',clipId:clip.value!.id,property:property.value,point:{...point,value:values[point.id]/factor.value,interpolation}}));}
function jump(direction:-1|1){
  if(!clip.value)return;const times=points.value.map(p=>toNumber(targetTimeAt(clip.value!,p.time))),h=props.c.playhead.value;
  const time=direction<0?times.filter(t=>t<h-1e-8).at(-1):times.find(t=>t>h+1e-8);
  if(time!==undefined){props.c.playing.value=false;props.c.seek(time);}
}
</script>
<template>
  <div v-if="clip" class="inspector-section keyframe-section">
    <header><strong>关键帧</strong><div class="keyframe-navigation"><button class="mini-icon" aria-label="上一个关键帧" @click="jump(-1)">‹</button><button class="keyframe-diamond" :class="{active}" aria-label="在播放头添加或更新关键帧" :disabled="disabled||!inside" @click="set">◆</button><button class="mini-icon" aria-label="下一个关键帧" @click="jump(1)">›</button></div></header>
    <div class="control-row"><a-select v-model:value="property" aria-label="关键帧属性" :options="options" /><a-input-number v-model:value="value" aria-label="关键帧当前值" :min="range[0]" :max="range[1]" :precision="2" :disabled="disabled||!inside" @press-enter="set" /><small>{{percent?'%':property==='rotation'?'°':'px'}}</small><a-button size="small" :disabled="disabled||!inside" @click="set">{{active?'更新':'添加'}}</a-button></div>
    <p v-if="!inside" class="quiet">将播放头移到所选片段内即可添加关键帧</p>
    <div v-if="points.length" class="keyframe-list"><div v-for="point in points" :key="point.id" class="keyframe-row">
      <button class="keyframe-time" @click="c.playing.value=false;c.seek(toNumber(targetTimeAt(clip!,point.time)))">◆ {{timecode(toNumber(targetTimeAt(clip,point.time)),toNumber(c.doc.value!.fps))}}</button>
      <a-input-number v-model:value="values[point.id]" :aria-label="'关键帧值 '+point.id" :min="range[0]" :max="range[1]" :precision="2" :disabled="disabled" @blur="update(point)" />
      <a-select :value="point.interpolation" :aria-label="'关键帧插值 '+point.id" :options="[{value:'linear',label:'线性'},{value:'hold',label:'保持'}]" :disabled="disabled" @change="(v:any)=>update(point,v)" />
      <button class="mini-icon" aria-label="删除关键帧" :disabled="disabled" @click="c.guard(()=>c.edit({type:'keyframe.remove',clipId:clip!.id,property,pointId:point.id}))">×</button>
    </div></div><p v-else class="quiet">{{labels[property]}}尚未添加关键帧</p>
  </div>
</template>
