import {createApp} from 'vue';
import Antd from 'ant-design-vue';
import App from './App.vue';
import {createEditorController} from './controller.ts';
import type {EditorOptions} from './controller.ts';
import type {Document} from '../../../packages/core/src/document.ts';
import './style.css';

export type EditorHandle = {ready: Promise<void>; open(document: Document): Promise<void>; dispose(): void};
export function mountEditor(container: HTMLElement, options: EditorOptions = {}): EditorHandle {
  const controller = createEditorController(options), app = createApp(App, {c: controller});
  app.use(Antd); app.mount(container);
  const ready = controller.initialize(); let disposed = false;
  return {ready, async open(document) {await ready; if (disposed) throw Error('EDITOR_DISPOSED'); await controller.open(document);},
    dispose() {if (disposed) return;disposed=true;controller.dispose();app.unmount();}};
}
