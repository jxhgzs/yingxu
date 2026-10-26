<script setup lang="ts">
import {VideoCameraOutlined, AudioOutlined, FontSizeOutlined, FolderOpenOutlined, ImportOutlined, ExportOutlined, PlusOutlined,
  UndoOutlined, RedoOutlined, ScissorOutlined, DeleteOutlined, CopyOutlined, PlayCircleOutlined, PauseCircleOutlined,
  StepBackwardOutlined, StepForwardOutlined, SoundOutlined, LockOutlined, UnlockOutlined, EyeOutlined, EyeInvisibleOutlined,
  ZoomInOutlined, ZoomOutOutlined, DownOutlined, SettingOutlined, CheckCircleOutlined, CloseOutlined,
  SlidersOutlined, SwapOutlined, CloudUploadOutlined, AppstoreOutlined, FileOutlined, ReloadOutlined, MenuOutlined, QuestionCircleOutlined, LinkOutlined} from '@ant-design/icons-vue';
defineProps<{name: string}>();
const paths:Record<string,string>={split:'M8 4H5v16h3M16 4h3v16h-3M12 3v18',cutLeft:'M7 4H4v16h3M16 4h3v16h-3M10 5h2m-2 4h2m-2 4h2m-2 4h2',cutRight:'M8 4H5v16h3M17 4h3v16h-3M12 5h2m-2 4h2m-2 4h2m-2 4h2',marker:'M5 4h14v9l-7 7-7-7V4Z',freeze:'M6 4h12v16H6zM3 6v12M21 6v12',reverse:'M18 8a7 7 0 1 0 1 7M18 3v6h-6M10 8l5 4-5 4V8Z',mirror:'M10 5 3 19h7V5ZM14 5l7 14h-7V5ZM12 3v2m0 3v2m0 3v2m0 3v3',rotate:'M7 5h10l3 5M20 3v7h-7M17 19H7l-3-5M4 21v-7h7',crop:'M7 3v14h14M3 7h14v14M20 4l-5 5',markerList:'M3 5h5v5l-2.5 3L3 10V5Zm9 1h9M12 11h9M3 18h18',magnet:'M5 4v9a7 7 0 0 0 14 0V4h-4v9a3 3 0 0 1-6 0V4H5Zm0 4h4m6 0h4'};
const icons: Record<string, any> = {video: VideoCameraOutlined, audio: AudioOutlined, text: FontSizeOutlined, folder: FolderOpenOutlined,
  import: ImportOutlined, export: ExportOutlined, plus: PlusOutlined, undo: UndoOutlined, redo: RedoOutlined,
  split: ScissorOutlined, delete: DeleteOutlined, copy: CopyOutlined, play: PlayCircleOutlined, pause: PauseCircleOutlined,
  previous: StepBackwardOutlined, next: StepForwardOutlined, sound: SoundOutlined, lock: LockOutlined, unlock: UnlockOutlined,
  eye: EyeOutlined, hidden: EyeInvisibleOutlined, zoomIn: ZoomInOutlined, zoomOut: ZoomOutOutlined, down: DownOutlined,
  settings: SettingOutlined, saved: CheckCircleOutlined, close: CloseOutlined, cloud: CloudUploadOutlined, grid: AppstoreOutlined,
  transition:SwapOutlined,adjust:SlidersOutlined,file: FileOutlined, reload: ReloadOutlined, menu: MenuOutlined, help: QuestionCircleOutlined, link: LinkOutlined};
</script>
<template><svg v-if="paths[name]" class="timeline-glyph" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]" /></svg><component v-else :is="icons[name] || icons.file" aria-hidden="true" /></template>
