<script setup lang="ts">
import {ref, watch} from 'vue';
import {theme} from 'ant-design-vue';
import type {EditorController} from './controller.ts';
import Icon from './components/Icon.vue';
import MediaBin from './components/MediaBin.vue';
import Preview from './components/Preview.vue';
import Timeline from './components/Timeline.vue';
import Inspector from './components/Inspector.vue';
import ExportDialog from './components/ExportDialog.vue';
const props=defineProps<{c:EditorController}>();
const root=ref<HTMLElement>(),mediaInput=ref<HTMLInputElement>(),projectInput=ref<HTMLInputElement>();
const exportOpen=ref(false),projectsOpen=ref(false),helpOpen=ref(false),tasksOpen=ref(false),draftMode=ref(false),uploading=ref(false),title=ref('');
watch(()=>props.c.doc.value?.title,value=>{title.value=value||'未命名工程';},{immediate:true});
const uiTheme={algorithm:theme.darkAlgorithm,token:{colorPrimary:'#5bbdc7',colorBgContainer:'#303034',colorBgElevated:'#303034',colorText:'#e6e6e9',colorBorder:'#45454c',borderRadius:4,fontSize:12,controlHeight:30,controlHeightSM:26},components:{Slider:{trackBg:'#5bbdc7',trackHoverBg:'#79d6dc'},Modal:{contentBg:'#252528',headerBg:'#252528'}}};
function popupContainer(trigger?:HTMLElement){return trigger?.closest<HTMLElement>('.yx-editor')||root.value||document.body;}
function importMedia(){mediaInput.value?.click();}
async function files(files:File[]){uploading.value=true;await props.c.guard(()=>props.c.upload(files));uploading.value=false;}
async function mediaChanged(e:Event){const el=e.target as HTMLInputElement;if(el.files)await files(Array.from(el.files));el.value='';}
async function projectChanged(e:Event){const el=e.target as HTMLInputElement;if(el.files?.[0])await props.c.guard(()=>props.c.importFile(el.files![0],draftMode.value));el.value='';}
function chooseProjectFile(draft:boolean){draftMode.value=draft;projectInput.value?.click();}
function menu({key}:{key:string|number}){
  if(key==='new')props.c.guard(props.c.createProject);
  else if(key==='projects')projectsOpen.value=true;
  else if(key==='open')chooseProjectFile(false);
  else if(key==='draft')chooseProjectFile(true);
  else if(key==='demo')props.c.guard(props.c.demo);
}
function saveTitle(){if(title.value.trim()&&title.value!==props.c.doc.value?.title)props.c.guard(()=>props.c.edit({type:'project.settings',title:title.value.trim()}));}
function focusEditor(event:PointerEvent){const target=event.target as HTMLElement;if(!target.closest('button,input,textarea,select,a,[role="combobox"],[role="slider"]'))root.value?.focus({preventScroll:true});}
function keyboard(event:KeyboardEvent){
  const target=event.target as HTMLElement;if(target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="combobox"]'))return;
  const modifier=event.metaKey||event.ctrlKey;
  if(modifier&&event.key.toLowerCase()==='z'){event.preventDefault();if(!props.c.busy.value)props.c.guard(()=>props.c.edit(undefined,event.shiftKey?'redo':'undo'));}
  else if(modifier&&event.key.toLowerCase()==='b'){event.preventDefault();props.c.guard(props.c.split);}
  else if(modifier&&event.key.toLowerCase()==='s'){event.preventDefault();}
  else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();props.c.guard(()=>props.c.remove(event.shiftKey));}
  else if(event.code==='Space'&&!target.closest('button')){event.preventDefault();if(!props.c.previewPending.value&&props.c.preview.value)props.c.playing.value=!props.c.playing.value;}
  else if(event.key==='Escape')props.c.selectedId.value=null;
}
async function openSaved(id:string){await props.c.guard(()=>props.c.loadProject(id));projectsOpen.value=false;}
function nativeDrop(event:DragEvent){if(event.dataTransfer?.files.length){event.preventDefault();files(Array.from(event.dataTransfer.files));}}
</script>
<template>
  <div ref="root" class="yx-editor" tabindex="0" @keydown="keyboard" @pointerdown.capture="focusEditor" @dragover.prevent @drop="nativeDrop">
    <a-config-provider :theme="uiTheme" :get-popup-container="popupContainer" component-size="small">
      <header class="app-titlebar"><div class="app-brand"><span class="brand-mark"><i></i><i></i><i></i></span><strong>映序</strong><a-dropdown><button class="project-menu">文件 <Icon name="down" /></button><template #overlay><a-menu @click="menu"><a-menu-item key="new">新建工程</a-menu-item><a-menu-item key="projects">打开最近工程</a-menu-item><a-menu-item key="open">打开工程文件…</a-menu-item><a-menu-item key="draft">导入剪映草稿…</a-menu-item><a-menu-divider /><a-menu-item key="demo">使用练习素材</a-menu-item></a-menu></template></a-dropdown><span class="save-indicator"><Icon :name="c.busy.value?'cloud':'saved'" />{{c.busy.value?'正在保存':'已自动保存'}}</span></div>
        <a-input v-model:value="title" class="project-title-input" aria-label="工程名称" :bordered="false" :disabled="c.readOnly.value" @blur="saveTitle" @press-enter="($event:any)=>$event.target.blur()" />
        <div class="titlebar-actions"><a-tooltip title="快捷键"><button class="icon-button" aria-label="快捷键" @click="helpOpen=true"><Icon name="help" /></button></a-tooltip><a-tooltip title="导出任务"><button class="icon-button" aria-label="导出任务" @click="tasksOpen=true"><Icon name="cloud" /></button></a-tooltip><a-button v-if="c.state.value" :href="c.api.url('/api/projects/'+c.state.value.id+'/download')" class="save-project"><Icon name="folder" />下载工程</a-button><a-button type="primary" class="export-main" :disabled="!c.total.value||c.readOnly.value" @click="exportOpen=true"><Icon name="export" />导出</a-button></div>
      </header>
      <a-alert v-if="c.error.value" class="workspace-alert" type="error" :message="c.error.value" closable show-icon @close="c.error.value=''" />
      <a-alert v-if="c.readOnly.value" class="workspace-alert" type="warning" message="此剪映草稿含尚未支持的效果或关键帧，已只读打开；原始数据完整保留。" show-icon />
      <div class="workspace"><MediaBin :c="c" @import="importMedia" @files="files" /><Preview :c="c" /><Inspector :c="c" /></div>
      <Timeline :c="c" />
      <div v-if="c.loading.value||uploading" class="workspace-loading"><a-spin /><span>{{uploading?'正在导入素材':'正在打开工程'}}</span></div>
      <input ref="mediaInput" type="file" multiple accept="video/*,audio/*,image/*" hidden @change="mediaChanged" />
      <input ref="projectInput" type="file" accept=".json" hidden @change="projectChanged" />
      <ExportDialog :c="c" v-model:open="exportOpen" />
      <a-modal v-model:open="projectsOpen" title="最近工程" :footer="null" :get-container="false"><div class="project-list"><button v-for="project in c.projects.value" :key="project.id" @click="openSaved(project.id)"><Icon name="file" /><span><strong>{{project.title}}</strong><small>{{new Date(project.updatedAt).toLocaleString('zh-CN')}}</small></span><Icon name="folder" /></button><p v-if="!c.projects.value.length" class="quiet">还没有工程</p></div></a-modal>
      <a-modal v-model:open="helpOpen" title="快捷键" :footer="null" :get-container="false"><dl class="shortcut-list"><dt>播放 / 暂停</dt><dd><kbd>Space</kbd></dd><dt>分割所选片段</dt><dd><kbd>⌘ / Ctrl B</kbd></dd><dt>撤销</dt><dd><kbd>⌘ / Ctrl Z</kbd></dd><dt>重做</dt><dd><kbd>⇧ ⌘ / Ctrl Z</kbd></dd><dt>删除片段</dt><dd><kbd>Delete</kbd></dd><dt>涟漪删除</dt><dd><kbd>⇧ Delete</kbd></dd><dt>取消选择</dt><dd><kbd>Esc</kbd></dd></dl><p class="quiet">输入文字时不会触发剪辑快捷键</p></a-modal>
      <a-modal v-model:open="tasksOpen" title="导出任务" :footer="null" :get-container="false"><div class="task-list"><article v-for="job in c.jobs.value.filter(j=>j.kind==='export')" :key="job.id"><div><strong>{{{queued:'等待导出',running:'正在导出',completed:'导出完成',failed:'导出失败',cancelled:'已取消',cancelling:'正在取消',interrupted:'已中断'}[job.status]}}</strong><small>{{new Date(job.createdAt).toLocaleString('zh-CN')}}</small></div><a-progress v-if="['queued','running'].includes(job.status)" :percent="Math.round(job.progress*100)" size="small" /><a v-if="job.result" :href="c.api.url(job.result.downloadUrl)">下载视频</a><a-button v-if="['running','queued'].includes(job.status)" @click="c.guard(()=>c.api.post('/api/jobs/'+job.id+'/cancel'))">取消任务</a-button><p v-if="job.error" class="export-error">{{job.error.slice(0,200)}}</p></article><p v-if="!c.jobs.value.some(j=>j.kind==='export')" class="quiet">还没有导出任务</p></div></a-modal>
    </a-config-provider>
  </div>
</template>
