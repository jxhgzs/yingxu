<script setup lang="ts">
import {ref, computed} from 'vue';
import type {EditorController} from '../controller.ts';
import {toNumber} from '../../../../packages/core/src/time.ts';
import Icon from './Icon.vue';
import Transitions from './Transitions.vue';
import ColorAdjustments from './ColorAdjustments.vue';
const props = defineProps<{c: EditorController}>();
const emit = defineEmits<{import: []; files: [File[]]}>();
const tab = ref('all'), search = ref('');
const filtered = computed(() => props.c.assets.value.filter(a => (!search.value || a.name?.toLowerCase().includes(search.value.toLowerCase())) && (tab.value !== 'audio' || a.kind === 'audio')));
function onDrag(event: DragEvent, id: string) {event.dataTransfer?.setData('application/x-yingxu-asset', id);}
function shortDuration(n: number) {return `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;}
</script>
<template>
  <section class="media-panel panel">
    <div class="media-tabs">
      <button :class="{active:tab==='all'}" @click="tab='all'"><Icon name="video" /><span>媒体</span></button>
      <button :class="{active:tab==='audio'}" @click="tab='audio'"><Icon name="audio" /><span>音频</span></button>
      <button :class="{active:tab==='text'}" @click="tab='text'"><Icon name="text" /><span>文本</span></button>
      <button :class="{active:tab==='transition'}" @click="tab='transition';c.inspectorTab.value='transition'"><Icon name="transition"/><span>转场</span></button>
      <button :class="{active:tab==='adjust'}" @click="tab='adjust';c.inspectorTab.value='adjust'"><Icon name="adjust"/><span>调节</span></button>
    </div>
    <div class="media-content">
      <nav class="media-nav"><button class="active">{{['transition','adjust'].includes(tab)?'基础':'本地'}}</button><span>{{tab==='text'?'新建文本':tab==='transition'?'叠化':tab==='adjust'?'画面':'导入'}}</span><div class="nav-rule"></div><small>素材库</small></nav>
      <div v-if="tab==='transition'||tab==='adjust'" class="effect-library"><Transitions v-if="tab==='transition'" :c="c"/><ColorAdjustments v-else :c="c"/></div>
      <div v-else-if="tab==='text'" class="text-library">
        <button class="text-template" :disabled="c.readOnly.value || c.busy.value" @click="c.guard(c.addText)"><span>默认文本</span><strong>添加文字</strong><Icon name="plus" /></button>
        <p class="quiet">添加后可在右侧修改文字和样式</p>
      </div>
      <div v-else class="asset-library" @dragover.prevent @drop.prevent.stop="$event.dataTransfer?.files.length&&emit('files',Array.from($event.dataTransfer.files))">
        <a-input v-model:value="search" size="small" placeholder="搜索素材名称" class="media-search" allow-clear />
        <div class="asset-tools"><a-button size="small" @click="emit('import')"><Icon name="plus" />导入</a-button><span>全部 {{filtered.length}}</span><Icon name="grid" /></div>
        <div v-if="!filtered.length" class="bin-empty"><Icon name="folder" /><p>导入视频、音频或图片</p><a-button size="small" type="primary" @click="emit('import')">导入素材</a-button><button class="text-link" @click="c.guard(c.demo)">使用练习素材</button></div>
        <div v-else class="asset-grid">
          <article v-for="asset in filtered" :key="asset.id" class="asset-card" draggable="true" @dragstart="onDrag($event,asset.id)" @dblclick="c.guard(()=>c.addAsset(asset))">
            <div class="asset-cover"><img :src="c.api.url('/media/'+asset.id+'/thumb')" :alt="asset.name" loading="lazy" /><span class="asset-duration">{{asset.kind==='image'?'图片':shortDuration(toNumber(asset.duration))}}</span><button :aria-label="'添加 '+asset.name+' 到时间线'" :disabled="c.busy.value||c.readOnly.value" @click.stop="c.guard(()=>c.addAsset(asset))"><Icon name="plus" /></button></div>
            <div class="asset-name" :title="asset.name">{{asset.name}}</div><small>{{asset.kind==='audio'?'音频':asset.width+' × '+asset.height}}</small>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>
