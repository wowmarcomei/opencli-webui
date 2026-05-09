import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const compatRange: string = pkg.opencli?.compatRange ?? '>=0.0.0';

export default defineConfig({
  root: __dirname,
  define: {
    __OPENCLI_COMPAT_RANGE__: JSON.stringify(compatRange),
  },
  build: {
    outDir: resolve(__dirname, '../public/opencli-remote-extension/dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/background.ts'),
      output: {
        entryFileNames: 'background.js',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
  },
});
