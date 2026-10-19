<script setup lang="ts">
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import type {EditorController} from '../controller.ts';
import type {Asset} from '../../../../packages/core/src/document.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';
import {applyAssetRelink} from '../../../../packages/core/src/relink.ts';
const props=defineProps<{c:EditorController;open:boolean}>(),emit=defineEmits<{'update:open':[boolean]}>();
const sourceId=ref<string>(),replacementId=ref<string>(),working=ref(false),localError=ref(''),fileInput=ref<HTMLInputElement|null>(null),boundProjectId=ref<string|null>(null),bindingLost=ref(false),samePath=ref(false);
let dialogEpoch=0,disposed=false;
const projectChanged=computed(()=>props.open&&(bindingLost.value||props.c.state.value?.id!==boundProjectId.value));
const bindingError=computed(()=>projectChanged.value?'工程已切换，请关闭窗口后在当前工程重新打开。':'');
const isActive=(epoch:number,projectId:string,assetId:string)=>!disposed&&props.open&&epoch===dialogEpoch&&boundProjectId.value===projectId&&props.c.state.value?.id===projectId&&sourceId.value===assetId;
onBeforeUnmount(()=>{disposed=true;dialogEpoch++;});
watch(()=>props.c.state.value?.id,id=>{if(props.open&&id!==boundProjectId.value){bindingLost.value=true;dialogEpoch++;working.value=false;}});
const originals=computed(()=>props.c.doc.value?.assets.filter(a=>a.kind!=='text')||[]);
const source=computed(()=>originals.value.find(a=>a.id===sourceId.value));
const compatible=(a:Asset,b:Asset)=>(a.kind==='audio')===(b.kind==='audio')&&a.kind!=='text'&&b.kind!=='text';
const candidates=computed(()=>props.c.assets.value.filter(a=>source.value&&compatible(source.value,a)));
const replacement=computed(()=>candidates.value.find(a=>a.id===replacementId.value));
const peers=computed(()=>originals.value.filter(a=>source.value&&a.path===source.value.path&&compatible(a,source.value)));
const sourceIds=computed(()=>samePath.value?peers.value.map(a=>a.id):sourceId.value?[sourceId.value]:[]);
const references=computed(()=>props.c.doc.value?.tracks.flatMap(t=>t.clips).filter(c=>sourceIds.value.includes(c.materialId)).length||0);
const inactive=computed(()=>!props.open||!boundProjectId.value||projectChanged.value||working.value||props.c.busy.value||props.c.readOnly.value);
const kindName=(a:Asset)=>({audio:'音频',image:'图片',video:'视频',text:'文字'}[a.kind||'video']);
const sizeLabel=(a:Asset)=>a.width&&a.height?`${a.width} × ${a.height}`:'—';
const lengthLabel=(a:Asset)=>`${toNumber(a.duration).toFixed(3)} 秒`;
const label=(a:Asset)=>`${a.name||a.id} · ${kindName(a)} · ${lengthLabel(a)}`;
function isLinked(a:Asset){return props.c.assets.value.some(r=>r.id===a.id&&r.path===a.path&&r.sha256===a.sha256);}
const errorMessage=(e:unknown)=>{
 const code=(e instanceof Error?e.message:String(e)).split(':')[0];
 return ({SOURCE_RANGE_EXCEEDED:'替换素材短于某个片段的源区间，请选择足够长的素材。',KEYFRAME_OUTSIDE_MATERIAL:'替换素材长度不足以保留现有关键帧。',TRACK_LOCKED:'此素材被锁定轨道引用，请先解锁相应轨道。',TIMING_NOT_INTERPRETED:'此素材包含尚未支持的时间映射，暂时不能重新链接。',RELINK_ID_CONFLICT:'工程里已有同一素材ID，但媒体记录不一致，不能复用。',RELINK_KIND_MISMATCH:'视频或图片只能替换画面素材；音频只能替换音频。',RELINK_TEXT_UNSUPPORTED:'文字素材不能在此重新链接。',RELINK_ASSET_NOT_FOUND:'原素材已不在工程中，请重新选择。'} as Record<string,string>)[code]||'无法重新链接：'+(e instanceof Error?e.message:String(e)).slice(0,200);
};
const preflight=computed(()=>{
 if(!props.c.doc.value||!source.value||!replacement.value)return {ok:false,error:''};
 if(source.value.id===replacement.value.id)return {ok:false,error:'请为原素材选择另一个已注册素材。'};
 try{let doc=props.c.doc.value;for(const id of sourceIds.value)doc=applyAssetRelink(doc,{assetId:id,replacement:replacement.value});return {ok:true,error:''};}catch(e){return {ok:false,error:errorMessage(e)};}
});
const contentNotice=computed(()=>!source.value||!replacement.value?'':!source.value.sha256?'原素材没有内容校验值。将使用你明确选择的替换素材。':source.value.sha256!==replacement.value.sha256?'两个素材内容不同。重新链接后，所有引用都将使用新素材的画面和声音。':'内容校验值相同，将恢复到已注册的素材。');
watch(()=>props.open,open=>{dialogEpoch++;if(open){boundProjectId.value=props.c.state.value?.id||null;bindingLost.value=false;working.value=false;samePath.value=false;const selected=props.c.selected.value?.asset;sourceId.value=selected&&selected.kind!=='text'?selected.id:originals.value.find(a=>!isLinked(a))?.id||originals.value[0]?.id;replacementId.value=undefined;localError.value='';}},{immediate:true});
watch(sourceId,()=>{replacementId.value=undefined;localError.value='';samePath.value=false;});
watch(replacementId,()=>{localError.value='';});
function close(){if(working.value)return;dialogEpoch++;emit('update:open',false);}
async function upload(event:Event){
 const input=event.target as HTMLInputElement,files=Array.from(input.files||[]);input.value='';if(!files.length||inactive.value||!source.value||!boundProjectId.value)return;
 const epoch=dialogEpoch,projectId=boundProjectId.value,assetId=source.value.id;
 working.value=true;localError.value='';const previous=new Set(props.c.assets.value.map(a=>a.id));
 try{await props.c.upload(files);if(!isActive(epoch,projectId,assetId))return;const added=candidates.value.filter(a=>!previous.has(a.id));if(added.length===1)replacementId.value=added[0].id;}
 catch(e){if(isActive(epoch,projectId,assetId)){localError.value=errorMessage(e);props.c.report(e);}}
 finally{if(isActive(epoch,projectId,assetId))working.value=false;}
}
async function relink(){
 if(projectChanged.value){localError.value=bindingError.value;return;}
 if(inactive.value||!preflight.value.ok||!source.value||!replacement.value||!boundProjectId.value)return;
 const epoch=dialogEpoch,projectId=boundProjectId.value,assetId=source.value.id;
 if(props.c.state.value?.id!==projectId){localError.value='工程已切换，请重新打开素材链接窗口。';return;}
 working.value=true;localError.value='';
 const commands=sourceIds.value.map(id=>({type:'asset.relink' as const,assetId:id,replacement:replacement.value!}));
 try{const result=await props.c.edit(commands.length===1?commands[0]:{type:'batch',commands});if(result&&isActive(epoch,projectId,assetId)){dialogEpoch++;emit('update:open',false);}}
 catch(e){if(isActive(epoch,projectId,assetId)){localError.value=errorMessage(e);props.c.report(e);}}
 finally{if(isActive(epoch,projectId,assetId))working.value=false;}
}
</script>
<template>
 <a-modal :open="open" title="重新链接素材" :footer="null" :width="660" :get-container="false" :closable="!working" :mask-closable="!working" @cancel="close">
  <div class="relink-form">
   <p class="relink-note">选择原素材与已导入的替换素材。将更新原素材的全部引用，保留现有剪辑区间、速度和关键帧。</p>
   <label>工程中的原素材<a-select v-model:value="sourceId" aria-label="待重新链接素材" :disabled="inactive||!originals.length" :options="originals.map(a=>({value:a.id,label:label(a)+(isLinked(a)?'':' · 未链接')}))"/></label>
   <a-checkbox v-if="peers.length>1" v-model:checked="samePath" :disabled="inactive">同时链接同一路径的 {{peers.length}} 个素材</a-checkbox>
   <label>替换为已导入素材<a-select v-model:value="replacementId" aria-label="替换素材" :disabled="inactive||!source" placeholder="请选择替换素材" show-search option-filter-prop="label" :options="candidates.map(a=>({value:a.id,label:label(a),disabled:a.id===sourceId}))"/></label>
   <div class="relink-upload"><input ref="fileInput" type="file" accept="video/*,audio/*,image/*" hidden @change="upload"/><a-button :loading="working" :disabled="inactive||!source" @click="fileInput?.click()">导入替换文件</a-button><span>导入后仍需点击“重新链接”保存。</span></div>
   <div v-if="source" class="relink-comparison">
    <section><h4>原素材</h4><strong>{{source.name||source.id}}</strong><dl><dt>类型</dt><dd>{{kindName(source)}}</dd><dt>时长</dt><dd>{{lengthLabel(source)}}</dd><dt>尺寸</dt><dd>{{sizeLabel(source)}}</dd><dt>校验值</dt><dd :title="source.sha256">{{source.sha256?source.sha256.slice(0,16)+'…':'未记录'}}</dd><dt>引用</dt><dd>{{references}} 个片段</dd></dl></section>
    <section><h4>替换素材</h4><template v-if="replacement"><strong>{{replacement.name||replacement.id}}</strong><dl><dt>类型</dt><dd>{{kindName(replacement)}}</dd><dt>时长</dt><dd>{{lengthLabel(replacement)}}</dd><dt>尺寸</dt><dd>{{sizeLabel(replacement)}}</dd><dt>校验值</dt><dd :title="replacement.sha256">{{replacement.sha256?replacement.sha256.slice(0,16)+'…':'未记录'}}</dd></dl></template><p v-else class="relink-note">尚未选择</p></section>
   </div>
   <p v-if="contentNotice" class="relink-note" role="status">{{contentNotice}}</p>
   <p v-if="bindingError||localError||preflight.error" class="relink-error" role="alert">{{bindingError||localError||preflight.error}}</p>
   <p v-if="!originals.length" class="relink-note">当前工程没有可重新链接的媒体素材。</p>
   <div class="modal-actions"><a-button :disabled="working" @click="close">取消</a-button><a-button type="primary" :loading="working" :disabled="inactive||!preflight.ok" @click="relink">{{references?'重新链接全部 '+references+' 处引用':'重新链接素材'}}</a-button></div>
  </div>
 </a-modal>
</template>
<style scoped>
.relink-form{display:flex;flex-direction:column;gap:14px}.relink-form>label{display:flex;flex-direction:column;gap:6px}.relink-form .ant-select{width:100%}.relink-note{margin:0;color:#9da2ae;font-size:12px;line-height:1.7}.relink-upload{display:flex;align-items:center;gap:12px}.relink-upload span{font-size:12px;color:#9da2ae}.relink-comparison{display:grid;grid-template-columns:1fr 1fr;gap:12px}.relink-comparison section{min-width:0;padding:12px;border:1px solid #34373e;border-radius:6px}.relink-comparison h4{margin:0 0 8px;color:#9da2ae;font-size:12px}.relink-comparison strong{display:block;overflow-wrap:anywhere;font-size:13px}.relink-comparison dl{display:grid;grid-template-columns:50px 1fr;gap:6px;margin:12px 0 0;font-size:12px}.relink-comparison dt{color:#9da2ae}.relink-comparison dd{margin:0;overflow-wrap:anywhere}.relink-error{margin:0;color:#ff8c81;font-size:12px;line-height:1.6}
</style>
