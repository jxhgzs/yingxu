<script setup lang="ts">
import {ref, reactive, watch, computed} from 'vue';
import type {EditorController} from '../controller.ts';
import {defaultTransform} from '../../../../packages/core/src/document.ts';
import {toNumber, decimal, rational, mul} from '../../../../packages/core/src/time.ts';
import Icon from './Icon.vue';
import Keyframes from './Keyframes.vue';
import CurveSpeed from './CurveSpeed.vue';
import Transitions from './Transitions.vue';
import ColorAdjustments from './ColorAdjustments.vue';
import {evaluateAnimation,sourceTimeAt} from '../../../../packages/core/src/animation.ts';
import type {AnimatedProperty} from '../../../../packages/core/src/animation.ts';
import type {AtomicCommand} from '../../../../packages/core/src/commands.ts';
import {atFrame} from '../controller.ts';
const props = defineProps<{c: EditorController}>();
const tab = props.c.inspectorTab, ripple = ref(true);
const speedMode=ref<'constant'|'curve'>('constant');
const draft = reactive({x:0,y:0,scale:100,rotation:0,opacity:100,flipX:false,flipY:false,volume:100,fadeIn:0,fadeOut:0,speed:1,sourceIn:0,sourceOut:0,textStart:0,textDuration:4,content:'',size:54,color:'#ffffff',font:'PingFang SC'});
const selected = computed(()=>props.c.selected.value), clip = computed(()=>selected.value?.clip);
const disabled = computed(()=>props.c.readOnly.value||props.c.busy.value||!!selected.value?.track.locked);
const trimDisabled=computed(()=>disabled.value||!!(clip.value?.speedCurve&&clip.value?.animations?.length));
const constantSpeedValid=computed(()=>typeof draft.speed==='number'&&Number.isFinite(draft.speed)&&draft.speed>=.0625&&draft.speed<=16);
watch(()=>[props.c.state.value?.id,props.c.state.value?.revision,props.c.selectedId.value],()=>{speedMode.value=clip.value?.speedCurve?'curve':'constant';},{immediate:true});
watch(()=>[props.c.state.value?.revision, props.c.selectedId.value,props.c.playhead.value],()=>{
  const c=clip.value;if(!c)return;const t={...(c.transform||defaultTransform())};
  const time=sourceTimeAt(c,atFrame(props.c.playhead.value,props.c.doc.value!.fps));
  for(const a of c.animations||[])if(a.property!=='volume')t[a.property]=evaluateAnimation(a,time);
  const audioAnimation=c.animations?.find(a=>a.property==='volume'),volume=audioAnimation?evaluateAnimation(audioAnimation,time):c.volume??1;
  Object.assign(draft,{x:t.x,y:t.y,scale:t.scale*100,rotation:t.rotation,opacity:t.opacity*100,flipX:t.flipX,flipY:t.flipY,
    fadeIn:toNumber(c.audioFade?.inDuration||rational(0)),fadeOut:toNumber(c.audioFade?.outDuration||rational(0)),volume:volume*100,speed:toNumber(c.speed),sourceIn:toNumber(c.source.start),sourceOut:toNumber(c.source.start)+toNumber(c.source.duration),
    textStart:toNumber(c.target.start),textDuration:toNumber(c.target.duration),content:c.text?.content||'',size:c.text?.size||54,color:c.text?.color||'#ffffff',font:c.text?.font||'PingFang SC'});
  if(selected.value?.track.kind==='text')tab.value='text';else if(selected.value?.track.kind==='audio')tab.value='audio';else if(!['picture','audio','speed','transition','adjust'].includes(tab.value))tab.value='picture';
},{immediate:true});
function transform() {
  if(!clip.value)return;
  return props.c.guard(()=>{
    const c=clip.value!,base=c.transform||defaultTransform(),next={x:draft.x,y:draft.y,scale:draft.scale/100,rotation:draft.rotation,opacity:draft.opacity/100,flipX:draft.flipX,flipY:draft.flipY};
    const commands:AtomicCommand[]=[],time=sourceTimeAt(c,atFrame(props.c.playhead.value,props.c.doc.value!.fps));
    for(const property of ['x','y','scale','rotation','opacity'] as AnimatedProperty[]){
      const a=c.animations?.find(a=>a.property===property);if(!a||property==='volume')continue;
      if(Math.abs(next[property]-evaluateAnimation(a,time))>1e-8)commands.push(props.c.keyframeCommand(property,next[property]));
      next[property]=base[property];
    }
    commands.push({type:'clip.update',clipId:c.id,changes:{transform:next}});return props.c.edit({type:'batch',commands});
  });
}
function audio() {if(clip.value)return props.c.guard(()=>props.c.edit(clip.value!.animations?.some(a=>a.property==='volume')?props.c.keyframeCommand('volume',draft.volume/100):{type:'clip.update',clipId:clip.value!.id,changes:{volume:draft.volume/100}}));}
function fades(){if(clip.value&&!disabled.value)return props.c.guard(()=>props.c.edit({type:'clip.update',clipId:clip.value!.id,changes:{audioFade:{curve:'qsin',inDuration:decimal(String(draft.fadeIn)),outDuration:decimal(String(draft.fadeOut))}}}));}
function speed() {if(clip.value&&!clip.value.speedCurve&&!disabled.value&&constantSpeedValid.value)return props.c.guard(()=>props.c.edit({type:'speed',clipId:clip.value!.id,value:decimal(String(draft.speed)),shiftFollowing:ripple.value}));}
function trim() {if(clip.value&&!trimDisabled.value)return props.c.guard(()=>props.c.edit({type:'clip.trim',clipId:clip.value!.id,sourceStart:decimal(String(draft.sourceIn)),sourceDuration:decimal((draft.sourceOut-draft.sourceIn).toFixed(6)),pushFollowing:props.c.trimFollowing.value}));}
function text() {if(clip.value)return props.c.guard(()=>props.c.edit({type:'clip.update',clipId:clip.value!.id,changes:{text:{...clip.value!.text!,content:draft.content,size:draft.size,color:draft.color,font:draft.font,lineHeight:clip.value!.text!.lineHeight===undefined?undefined:clip.value!.text!.lineHeight*draft.size/clip.value!.text!.size}}}));}
function textRange() {if(clip.value&&!clip.value.speedCurve&&!disabled.value)return props.c.guard(()=>props.c.edit({type:'clip.trim',clipId:clip.value!.id,sourceStart:rational(0),sourceDuration:mul(decimal(String(draft.textDuration)),clip.value!.speed),targetStart:decimal(String(draft.textStart))}));}
function canvas(value: string) {const [width,height]=value.split('x').map(Number);props.c.guard(()=>props.c.edit({type:'project.settings',canvas:{width,height}}));}
function fps(value: string) {const [n,d='1']=value.split('/');props.c.guard(()=>props.c.edit({type:'project.settings',fps:rational(n,d)}));}
</script>
<template>
  <aside class="inspector-panel panel">
    <template v-if="selected&&clip">
      <div class="inspector-tabs"><button v-if="selected.track.kind!=='audio'" :class="{active:tab==='picture'}" @click="tab='picture'">画面</button><button v-if="selected.track.kind==='text'" :class="{active:tab==='text'}" @click="tab='text'">文本</button><button v-if="selected.asset.hasAudio||selected.track.kind==='audio'" :class="{active:tab==='audio'}" @click="tab='audio'">音频</button><button v-if="selected.track.kind==='video'" :class="{active:tab==='adjust'}" @click="tab='adjust'">调节</button><button v-if="selected.track.kind==='video'" :class="{active:tab==='transition'}" @click="tab='transition'">转场</button><button :class="{active:tab==='speed'}" @click="tab='speed'">变速</button></div>
      <div class="inspector-scroll">
        <a-alert v-if="selected.track.locked" type="warning" message="轨道已锁定" show-icon class="compact-alert" />
        <template v-if="tab==='picture'">
          <div class="inspector-section"><header><strong>位置大小</strong><button class="mini-icon" aria-label="重置位置大小" :disabled="disabled" @click="c.guard(()=>c.edit({type:'clip.update',clipId:clip!.id,changes:{transform:defaultTransform()}}))"><Icon name="undo" /></button></header>
            <div class="control-row"><span>缩放</span><a-slider v-model:value="draft.scale" :min="1" :max="300" :disabled="disabled" @after-change="transform" /><a-input-number v-model:value="draft.scale" aria-label="缩放百分比" :min="1" :max="1000" :precision="1" :disabled="disabled" @blur="transform" /><small>%</small></div>
            <div class="control-row"><span>位置</span><label>X <a-input-number v-model:value="draft.x" aria-label="水平位置" :disabled="disabled" @blur="transform" /></label><label>Y <a-input-number v-model:value="draft.y" aria-label="垂直位置" :disabled="disabled" @blur="transform" /></label></div>
            <div class="control-row"><span>旋转</span><a-input-number v-model:value="draft.rotation" aria-label="旋转角度" :min="-360" :max="360" :disabled="disabled" @blur="transform" /><small>°</small><a-checkbox v-if="selected.track.kind!=='text'" v-model:checked="draft.flipX" :disabled="disabled" @change="transform">水平翻转</a-checkbox></div>
          </div>
          <div class="inspector-section"><header><strong>混合</strong></header><div class="control-row"><span>不透明度</span><a-slider v-model:value="draft.opacity" :min="0" :max="100" :disabled="disabled" @after-change="transform" /><a-input-number v-model:value="draft.opacity" aria-label="不透明度" :min="0" :max="100" :disabled="disabled" @blur="transform" /><small>%</small></div></div>
        </template>
        <template v-if="tab==='audio'"><div class="inspector-section"><header><strong>音量</strong><Icon name="sound" /></header><div class="control-row"><a-slider v-model:value="draft.volume" :min="0" :max="200" :disabled="disabled" @after-change="audio" /><a-input-number v-model:value="draft.volume" aria-label="片段音量" :min="0" :max="400" :disabled="disabled" @blur="audio" /><small>%</small></div><a-checkbox :checked="!!clip.muted" :disabled="disabled" @change="(event:any)=>c.guard(()=>c.edit({type:'clip.update',clipId:clip!.id,changes:{muted:event.target.checked}}))">静音</a-checkbox></div><div class="inspector-section"><header><strong>淡入淡出</strong></header><div class="control-row"><span>淡入时长</span><a-input-number v-model:value="draft.fadeIn" aria-label="淡入秒" :min="0" :max="toNumber(clip.target.duration)" :precision="6" :step="0.1" :disabled="disabled" /><small>秒</small></div><div class="control-row"><span>淡出时长</span><a-input-number v-model:value="draft.fadeOut" aria-label="淡出秒" :min="0" :max="toNumber(clip.target.duration)" :precision="6" :step="0.1" :disabled="disabled" /><small>秒</small></div><a-button size="small" :disabled="disabled" @click="fades">应用淡入淡出</a-button></div></template>
        <template v-if="tab==='speed'"><div class="inspector-section"><header><strong>变速</strong></header>
          <a-radio-group v-model:value="speedMode" aria-label="变速方式" size="small" :disabled="disabled"><a-radio-button value="constant" :disabled="!!clip.speedCurve">常规</a-radio-button><a-radio-button value="curve">曲线</a-radio-button></a-radio-group>
          <template v-if="speedMode==='constant'&&!clip.speedCurve"><div class="control-row"><span>速度</span><a-input-number v-model:value="draft.speed" aria-label="片段速度" :min="0.0625" :max="16" :step="0.25" :precision="4" :disabled="disabled" /><small>倍</small><a-button size="small" :disabled="disabled||!constantSpeedValid" @click="speed">应用</a-button></div><a-checkbox v-model:checked="ripple" :disabled="disabled">联动后续片段</a-checkbox><p class="quiet">{{constantSpeedValid?'变速后时长 '+(toNumber(clip.source.duration)/draft.speed).toFixed(3)+' 秒':'请输入0.0625至16倍的速度'}}</p></template>
          <CurveSpeed v-else :c="c" v-model:shift-following="ripple"/>
        </div></template>
        <template v-if="tab==='text'"><div class="inspector-section"><header><strong>正文</strong></header><a-textarea v-model:value="draft.content" aria-label="文字内容" :rows="4" :maxlength="2000" :disabled="disabled" @blur="text" /><div class="control-row"><span>字体</span><a-select v-model:value="draft.font" aria-label="字体" :disabled="disabled" :options="[{value:'Source Han Sans SC Medium',label:'思源黑体 Medium'},{value:'PingFang SC',label:'苹方'},{value:'Heiti SC',label:'黑体'},{value:'Arial',label:'Arial'}]" @change="text" /></div><div class="control-row"><span>字号</span><a-input-number v-model:value="draft.size" aria-label="字号" :min="8" :max="500" :disabled="disabled" @blur="text" /><label class="color-picker" title="文字颜色"><input v-model="draft.color" aria-label="文字颜色" type="color" :disabled="disabled" @change="text" /><span>{{draft.color}}</span></label></div></div></template>
        <Transitions v-if="tab==='transition'" :c="c" />
        <ColorAdjustments v-if="tab==='adjust'" :c="c" />
        <Keyframes v-if="tab!=='transition'" :c="c" />
        <div v-if="selected.track.kind==='text'" class="inspector-section"><header><strong>显示时间</strong></header><div class="control-row"><span>开始</span><a-input-number v-model:value="draft.textStart" aria-label="文字开始秒" :min="0" :precision="3" :disabled="disabled||!!clip.speedCurve" /><small>秒</small></div><div class="control-row"><span>持续</span><a-input-number v-model:value="draft.textDuration" aria-label="文字时长秒" :min="0.001" :precision="3" :disabled="disabled||!!clip.speedCurve" /><small>秒</small><a-button size="small" :disabled="disabled||!!clip.speedCurve" @click="textRange">应用</a-button></div><p v-if="clip.speedCurve" class="quiet">请先在变速中取消曲线并恢复常速，再修改显示时间。</p></div>
        <template v-else><div class="inspector-section"><header><strong>采用区间</strong></header><div class="control-row"><span>源入点</span><a-input-number v-model:value="draft.sourceIn" aria-label="源入点秒" :min="0" :precision="6" :step="0.1" :disabled="trimDisabled" /><small>秒</small></div><div class="control-row"><span>源出点</span><a-input-number v-model:value="draft.sourceOut" aria-label="源出点秒" :min="0.001" :precision="6" :step="0.1" :disabled="trimDisabled" /><small>秒</small><a-button size="small" :disabled="trimDisabled" @click="trim">应用裁切</a-button></div><a-checkbox v-if="clip.speedCurve" v-model:checked="c.trimFollowing.value" :disabled="trimDisabled">裁切时推开后续片段</a-checkbox><p v-if="clip.speedCurve&&clip.animations?.length" class="quiet">含属性关键帧的曲线片段暂不支持直接裁切。</p><p class="quiet">目标时长 {{toNumber(clip.target.duration).toFixed(3)}} 秒</p></div>
        <div class="inspector-section source-details"><header><strong>素材信息</strong></header><p>{{selected.asset.name}}</p><dl><dt>开始</dt><dd>{{toNumber(clip.target.start).toFixed(3)}} 秒</dd><dt>源时长</dt><dd>{{toNumber(selected.asset.duration).toFixed(3)}} 秒</dd><template v-if="selected.asset.width"><dt>尺寸</dt><dd>{{selected.asset.width}} × {{selected.asset.height}}</dd></template></dl></div></template>
      </div>
    </template>
    <template v-else>
      <header class="panel-heading">工程信息</header><div class="inspector-scroll"><div class="inspector-section"><header><strong>{{c.doc.value?.title||'未命名工程'}}</strong></header><p class="quiet">选择时间线片段，调整画面、声音和速度</p></div>
      <div class="inspector-section"><header><strong>工程设置</strong></header><div class="control-row"><span>画幅</span><a-select :value="c.doc.value?c.doc.value.canvas.width+'x'+c.doc.value.canvas.height:'1920x1080'" aria-label="工程画幅" :disabled="c.busy.value||c.readOnly.value" :options="[{value:'1920x1080',label:'1920 × 1080'},{value:'1280x720',label:'1280 × 720'},{value:'1080x1920',label:'1080 × 1920'},{value:'720x1280',label:'720 × 1280'}]" @change="(v:any)=>canvas(v)" /></div>
      <div class="control-row"><span>帧率</span><a-select :value="c.doc.value?c.doc.value.fps.numerator+'/'+c.doc.value.fps.denominator:'30/1'" aria-label="工程帧率" :disabled="c.busy.value||c.readOnly.value" :options="[{value:'24/1',label:'24 fps'},{value:'25/1',label:'25 fps'},{value:'30/1',label:'30 fps'},{value:'30000/1001',label:'29.97 fps'},{value:'50/1',label:'50 fps'},{value:'60/1',label:'60 fps'}]" @change="(v:any)=>fps(v)" /></div></div>
      <div class="inspector-section source-details"><header><strong>保存</strong><Icon name="saved" /></header><p>{{c.busy.value?'正在保存…':'工程已自动保存到本地'}}</p><p class="quiet">撤销与重做记录随工程保留</p></div></div>
    </template>
  </aside>
</template>
