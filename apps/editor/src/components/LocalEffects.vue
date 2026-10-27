<script setup lang="ts">
import {computed,onMounted,ref} from 'vue';
import type {EditorController} from '../controller.ts';
import type {Asset} from '../../../../packages/core/src/document.ts';
import type {LocalEffect,LocalEffectCatalog} from '../../../../packages/core/src/local-effects.ts';
import type {TextAnimation} from '../../../../packages/core/src/text-animation.ts';
import {canRenderTextAnimationText,validateTextAnimations} from '../../../../packages/core/src/text-animation.ts';
import {compare,div,rational,sub} from '../../../../packages/core/src/time.ts';
const props=defineProps<{c:EditorController}>();
const catalog=ref<LocalEffectCatalog>(),loading=ref(false),importing=ref(false),query=ref(''),showUnavailable=ref(false),notice=ref('');
const entries=computed(()=>catalog.value?.entries.filter(e=>(showUnavailable.value||e.available)&&(!query.value||`${e.name} ${e.resourceId}`.includes(query.value)))||[]);
async function refresh(){loading.value=true;try{catalog.value=await props.c.api.get('/api/local-effects');}finally{loading.value=false;}}
onMounted(()=>props.c.guard(refresh));
function unavailable(entry:LocalEffect){
 if(!entry.available)return entry.reason;
 if(loading.value||importing.value||props.c.loading.value||props.c.busy.value)return '正在处理，请稍候';
 if(props.c.readOnly.value||!props.c.doc.value)return '请先打开可编辑工程';
 if(entry.animation){
  const selected=props.c.selected.value;if(selected?.asset.kind!=='text')return '请先选择文字片段';
  if(selected.track.locked)return '请先解锁文字轨道';
  if(['sway','alternate-scale'].includes(entry.animation.kind)&&(!canRenderTextAnimationText(selected.clip.text?.content||'')||(selected.clip.text?.content.length||0)>128))return '逐字动画支持128字以内的常用汉字、英文、空格和换行';
  const proposed=animationFor(entry);if(!proposed)return '片段中没有足够的动画时间';
 }
 return '';
}
function animationFor(entry:LocalEffect):TextAnimation[]|undefined{
 const clip=props.c.selected.value?.clip;if(!clip||!entry.animation)return;
 const remaining=(clip.textAnimations||[]).filter(a=>a.phase!==entry.animation!.phase);
 let available=clip.target.duration;
 for(const animation of remaining)if(animation.phase!=='loop')available=sub(available,animation.duration);
 if(entry.animation.phase!=='loop'){
  const loop=remaining.find(a=>a.phase==='loop');if(loop)available=sub(available,loop.duration);
 }
 const preferred=entry.animation.kind==='alternate-scale'?rational(11,8):rational(1,2),duration=compare(available,preferred)<0?available:preferred;
 const values=[...remaining,{...entry.animation,duration}];
 try{validateTextAnimations(values,clip.target.duration);return values;}catch{return;}
}
async function apply(entry:LocalEffect){
 if(unavailable(entry))return;const projectId=props.c.state.value!.id,revision=props.c.state.value!.revision,clipId=props.c.selectedId.value;
 importing.value=true;notice.value='';
 try{
  const result=await props.c.api.post<{asset?:Asset;animation?:TextAnimation}>('/api/local-effects/import',{key:entry.key});
  if(props.c.state.value?.id!==projectId||props.c.state.value.revision!==revision||props.c.selectedId.value!==clipId){notice.value='工程或选择已变化，请重新应用';return;}
  if(result.animation){const animations=animationFor(entry);if(!animations||props.c.selected.value?.track.locked)return;
   await props.c.edit({type:'clip.update',clipId:clipId!,changes:{textAnimations:animations}});props.c.inspectorTab.value='text';notice.value=`已应用 ${entry.name}`;
  }else if(result.asset){props.c.assets.value=[...props.c.assets.value.filter(a=>a.id!==result.asset!.id),result.asset];notice.value=`已加入媒体素材库：${entry.name}，可添加到时间线`;}
 }finally{importing.value=false;}
}
</script>
<template>
 <div class="local-effects-library" aria-label="本地特效库">
  <div class="local-effects-toolbar"><a-input v-model:value="query" placeholder="搜索特效名称或资源编号" aria-label="搜索本地特效" allow-clear/><a-button size="small" :disabled="loading||importing" @click="c.guard(refresh)">重新扫描</a-button></div>
  <p class="quiet">本机已有资源 · 可用 {{catalog?.entries.filter(e=>e.available).length||0}} / 已扫描 {{catalog?.entries.length||0}} <a-checkbox v-model:checked="showUnavailable">显示未适配</a-checkbox></p>
  <p v-if="notice" role="status">{{notice}}</p>
  <p v-if="!loading&&!entries.length" class="quiet">没有匹配资源。本地缓存不包含完整在线特效商城。</p>
  <div class="local-effects-grid">
   <article v-for="entry in entries" :key="entry.key" class="local-effect-card" :class="{unavailable:!entry.available}">
    <strong>{{entry.name}}</strong><small>{{entry.category==='text'?'文字动画':entry.category==='sequence'?'动态叠加':entry.category==='sticker'?'贴纸':entry.category==='font'?'字体':'未适配'}} · {{entry.resourceId}}<span v-if="entry.paid==='observed-paid'"> · 付费资源</span></small>
    <p>{{entry.reason}}</p><a-button size="small" :disabled="!!unavailable(entry)" :title="unavailable(entry)||entry.reason" @click="c.guard(()=>apply(entry))">{{entry.animation?'应用到文字':'导入素材库'}}</a-button><small v-if="entry.available&&unavailable(entry)">{{unavailable(entry)}}</small>
   </article>
  </div>
 </div>
</template>
<style scoped>
.local-effects-library{flex:1;min-width:0;padding:14px;overflow:auto}.local-effects-toolbar{display:flex;gap:8px}.local-effects-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}.local-effect-card{padding:12px;background:#29292e;border:1px solid #42424a;border-radius:6px;display:flex;align-items:flex-start;flex-direction:column;gap:7px}.local-effect-card small{color:#aaa;overflow-wrap:anywhere}.local-effect-card p{color:#bbb;font-size:12px;line-height:1.5;flex:1;margin:0}.local-effect-card.unavailable{opacity:.55}
</style>
