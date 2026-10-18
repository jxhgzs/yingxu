import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  build:{ssr:fileURLToPath(new URL('../service/server.ts',import.meta.url)),outDir:fileURLToPath(new URL('../../dist-desktop/service',import.meta.url)),emptyOutDir:true,
    rollupOptions:{output:{entryFileNames:'server.mjs'}}}
});
