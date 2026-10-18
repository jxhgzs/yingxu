<script setup lang="ts">
import {VideoCameraOutlined, AudioOutlined, FontSizeOutlined, FolderOpenOutlined, ImportOutlined, ExportOutlined, PlusOutlined,
  UndoOutlined, RedoOutlined, ScissorOutlined, DeleteOutlined, CopyOutlined, PlayCircleOutlined, PauseCircleOutlined,
  StepBackwardOutlined, StepForwardOutlined, SoundOutlined, LockOutlined, UnlockOutlined, EyeOutlined, EyeInvisibleOutlined,
  ZoomInOutlined, ZoomOutOutlined, DownOutlined, SettingOutlined, CheckCircleOutlined, CloseOutlined,
  CloudUploadOutlined, AppstoreOutlined, FileOutlined, ReloadOutlined, MenuOutlined, QuestionCircleOutlined, LinkOutlined} from '@ant-design/icons-vue';
defineProps<{name: string}>();
const icons: Record<string, any> = {video: VideoCameraOutlined, audio: AudioOutlined, text: FontSizeOutlined, folder: FolderOpenOutlined,
  import: ImportOutlined, export: ExportOutlined, plus: PlusOutlined, undo: UndoOutlined, redo: RedoOutlined,
  split: ScissorOutlined, delete: DeleteOutlined, copy: CopyOutlined, play: PlayCircleOutlined, pause: PauseCircleOutlined,
  previous: StepBackwardOutlined, next: StepForwardOutlined, sound: SoundOutlined, lock: LockOutlined, unlock: UnlockOutlined,
  eye: EyeOutlined, hidden: EyeInvisibleOutlined, zoomIn: ZoomInOutlined, zoomOut: ZoomOutOutlined, down: DownOutlined,
  settings: SettingOutlined, saved: CheckCircleOutlined, close: CloseOutlined, cloud: CloudUploadOutlined, grid: AppstoreOutlined,
  file: FileOutlined, reload: ReloadOutlined, menu: MenuOutlined, help: QuestionCircleOutlined, link: LinkOutlined};
</script>
<template><component :is="icons[name] || icons.file" aria-hidden="true" /></template>
