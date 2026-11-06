import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// The studio fetches the dataset at runtime; Vite bundles its JS and CSS.
function copyData() {
  return {
    name: 'copy-data',
    apply: 'build',
    closeBundle() {
      cpSync(resolve(root, 'data'), resolve(root, 'dist/data'), { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  appType: 'mpa',
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
  plugins: [copyData()],
});
