import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), plugins: [vue()],
  build: {outDir: '../../dist', emptyOutDir: true,rollupOptions:{input:{editor:fileURLToPath(new URL('./index.html',import.meta.url)),lifecycle:fileURLToPath(new URL('./lifecycle-test.html',import.meta.url))}}},
  server: {host: '127.0.0.1', port: 8816, strictPort: true,
    fs: {allow: [fileURLToPath(new URL('../../', import.meta.url))]},
    proxy: Object.fromEntries(['/api', '/media', '/renders', '/text-renders', '/curve-audio'].map(prefix => [prefix, {target: 'http://127.0.0.1:8815'}]))}
});
