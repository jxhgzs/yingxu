<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import type {EditorController} from '../controller.ts';
import type {SpeedCurve} from '../../../../packages/core/src/curve-speed.ts';
import {curveAverageSpeed,curveDuration,validateSpeedCurve} from '../../../../packages/core/src/curve-speed.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';

const props=defineProps<{c:EditorController;shiftFollowing:boolean}>();
const emit=defineEmits<{'update:shiftFollowing':[boolean]}>();
type Row={key:string;x:number|null;y:number|null};
const rows=ref<Row[]>([]);
const selected=computed(()=>props.c.selected.value),clip=computed(()=>selected.value?.clip);
const disabled=computed(()=>props.c.busy.value||props.c.readOnly.value||!!selected.value?.track.locked||!clip.value?.editableTiming);
const defaults=()=>[0,.25,.5,.75,1].map(x=>({x,y:1}));
const replace=(points:SpeedCurve['points'])=>{rows.value=points.map(point=>({...point,key:crypto.randomUUID()}));};
watch(()=>[props.c.state.value?.id,props.c.state.value?.revision,props.c.selectedId.value],()=>{
  replace(clip.value?.speedCurve?.points||defaults());
},{immediate:true});
const preview=computed(()=>{
  try{
    const points=rows.value.map(row=>{
      if(typeof row.x!=='number'||typeof row.y!=='number')throw Error('EMPTY_POINT');
      return {x:row.x,y:row.y};
    });
    const curve:SpeedCurve={points};validateSpeedCurve(curve);
    if(!clip.value||!props.c.doc.value)return {curve:null,error:'请先选择片段。'};
    return {curve,average:curveAverageSpeed(curve),duration:curveDuration(curve,clip.value.source.duration,props.c.doc.value.fps),error:''};
  }catch(e){
    return {curve:null,error:(e as Error).message==='CURVE_DURATION_EMPTY'?'变速后不足一帧，请降低速度。':'位置须从0递增到1，速度须为0.1至10倍；请补全每个点。'};
  }
});
const dirty=computed(()=>!!preview.value.curve&&JSON.stringify(preview.value.curve.points)!==JSON.stringify(clip.value?.speedCurve?.points));
const plotX=(x:number)=>32+x*212;
const plotY=(y:number)=>112-(Math.log10(y)+1)*46;
const plotPoints=computed(()=>rows.value.filter((point):point is Row&{x:number;y:number}=>typeof point.x==='number'&&typeof point.y==='number'&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.x<=1&&point.y>=.1&&point.y<=10));
const path=computed(()=>{
  const points=preview.value.curve?.points;if(!points)return '';
  const samples=[points[0]];
  for(let i=1;i<points.length;i++)for(let step=1;step<=16;step++){
    const t=step/16,a=points[i-1],b=points[i];
    samples.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t*t*(3-2*t)});
  }
  return samples.map((point,i)=>`${i?'L':'M'}${plotX(point.x).toFixed(3)},${plotY(point.y).toFixed(3)}`).join(' ');
});
function addPoint(){
  const points=preview.value.curve?.points;if(disabled.value||!points||points.length>=100)return;
  let gap=0,index=1;
  for(let i=1;i<points.length;i++)if(points[i].x-points[i-1].x>gap){gap=points[i].x-points[i-1].x;index=i;}
  const a=points[index-1],b=points[index];
  rows.value.splice(index,0,{key:crypto.randomUUID(),x:(a.x+b.x)/2,y:(a.y+b.y)/2});
}
function removePoint(index:number){if(!disabled.value&&index>0&&index<rows.value.length-1)rows.value.splice(index,1);}
function apply(){
  if(disabled.value||!clip.value||!preview.value.curve||!dirty.value)return;
  const curve=preview.value.curve;
  return props.c.guard(()=>props.c.edit({type:'speed.curve',clipId:clip.value!.id,curve,shiftFollowing:props.shiftFollowing}));
}
function reset(){
  if(disabled.value||!clip.value)return;
  return props.c.guard(()=>props.c.edit({type:'speed.curve',clipId:clip.value!.id,curve:null,shiftFollowing:props.shiftFollowing}));
}
</script>

<template>
  <div class="curve-speed-editor">
    <div class="curve-heading"><strong>自定义曲线</strong><span>{{rows.length}} / 100 点</span></div>
    <svg class="curve-graph" viewBox="0 0 260 142" role="img" aria-label="自定义变速曲线预览">
      <line v-for="value in [.1,1,10]" :key="value" x1="32" x2="244" :y1="plotY(value)" :y2="plotY(value)" :class="{baseline:value===1}"/>
      <text v-for="value in [.1,1,10]" :key="'y'+value" x="27" :y="plotY(value)+3" text-anchor="end">{{value}}×</text>
      <line v-for="value in [0,.25,.5,.75,1]" :key="'x'+value" :x1="plotX(value)" :x2="plotX(value)" y1="20" y2="112"/>
      <path :d="path"/>
      <circle v-for="(point,i) in plotPoints" :key="point.key" :cx="plotX(point.x)" :cy="plotY(point.y)" r="3"><title>点{{i+1}}：源位置{{point.x}}，{{point.y}}倍</title></circle>
      <text x="32" y="128">0%</text><text x="244" y="128" text-anchor="end">100%</text>
    </svg>
    <p class="quiet curve-help">横轴为源片段位置；纵轴为速度。修改后点击应用。</p>
    <div class="curve-point-head"><span>点</span><span>源位置 0–1</span><span>速度（倍）</span><span/></div>
    <div class="curve-points">
      <div v-for="(point,index) in rows" :key="point.key" class="curve-point-row">
        <span>{{index+1}}</span>
        <a-input-number v-model:value="point.x" :aria-label="'曲线点'+(index+1)+'源位置'" :min="0" :max="1" :step=".05" :precision="6" :disabled="disabled||index===0||index===rows.length-1"/>
        <a-input-number v-model:value="point.y" :aria-label="'曲线点'+(index+1)+'速度'" :min=".1" :max="10" :step=".1" :precision="6" :disabled="disabled"/>
        <button class="mini-icon" :aria-label="'删除曲线点'+(index+1)" :disabled="disabled||index===0||index===rows.length-1" @click="removePoint(index)">×</button>
      </div>
    </div>
    <div class="curve-local-actions"><a-button size="small" :disabled="disabled||!preview.curve||rows.length>=100" @click="addPoint">添加点</a-button><a-button size="small" :disabled="disabled" @click="replace(defaults())">恢复默认点</a-button></div>
    <a-alert v-if="preview.error" type="warning" :message="preview.error" show-icon class="compact-alert"/>
    <p v-else class="quiet">{{dirty?'应用后时长':'当前时长'}} {{toNumber(!dirty&&clip?.speedCurve?clip.target.duration:preview.duration!).toFixed(3)}} 秒 · 平均 {{preview.average!.toFixed(3)}} 倍</p>
    <p v-if="clip?.speedCurve&&dirty" class="quiet">当前时长 {{toNumber(clip.target.duration).toFixed(3)}} 秒</p>
    <a-checkbox :checked="shiftFollowing" :disabled="disabled" @update:checked="emit('update:shiftFollowing',$event)">联动后续片段</a-checkbox>
    <div class="curve-submit-actions"><a-button size="small" type="primary" :disabled="disabled||!preview.curve||!dirty" @click="apply">应用曲线</a-button><a-button size="small" :disabled="disabled" @click="reset">取消曲线并恢复1倍</a-button></div>
  </div>
</template>

<style scoped>
.curve-heading{display:flex;justify-content:space-between;align-items:center;font-size:11px;margin:14px 0 8px}.curve-heading>span{color:var(--muted);font-size:10px}.curve-graph{display:block;width:100%;background:#151519;border:1px solid #34343b;border-radius:4px}.curve-graph line{stroke:#303039;stroke-width:.6}.curve-graph line.baseline{stroke:#555563;stroke-dasharray:3 3}.curve-graph text{font-size:8px;fill:#898995}.curve-graph path{fill:none;stroke:var(--accent);stroke-width:1.8}.curve-graph circle{fill:#1c1c1f;stroke:var(--accent);stroke-width:1.5}.curve-help{margin:6px 0 10px!important}.curve-point-head,.curve-point-row{display:grid;grid-template-columns:18px minmax(0,1fr) minmax(0,1fr) 24px;gap:5px;align-items:center}.curve-point-head{font-size:9px;color:var(--muted);margin-bottom:6px}.curve-point-row{margin-bottom:6px;font-size:10px;color:var(--muted)}.curve-point-row :deep(.ant-input-number){width:100%;min-width:0}.curve-point-row :deep(.ant-input-number-input){padding:0 5px;font-size:10px}.curve-points{max-height:230px;overflow:auto;scrollbar-width:thin}.curve-local-actions,.curve-submit-actions{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}.curve-submit-actions :deep(.ant-btn){font-size:10px}
</style>
