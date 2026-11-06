import { defineConfig } from 'vite';
import { cpSync, createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// Vite's static server sends *.gz with Content-Encoding: gzip, so the browser
// decompresses them. The original viewer gunzips the bytes itself (tsne.js get()),
// so serve .gz files raw, like a plain static host does.
function rawGzip() {
  const handler = (req, res, next) => {
    const path = decodeURIComponent((req.url || '').split('?')[0]);
    if (!path.endsWith('.gz')) return next();
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root)) return next();
    let stat;
    try { stat = statSync(file); } catch { return next(); }
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Length', stat.size);
    createReadStream(file).pipe(res);
  };
  return {
    name: 'raw-gzip',
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}

// The original viewer (index.html) loads classic <script> files and both pages
// fetch data/ at runtime, so these folders are copied to dist/ as-is.
// The print studio's ES modules (assets/print/) are bundled by Vite.
function copyStatic() {
  return {
    name: 'copy-static',
    apply: 'build',
    closeBundle() {
      for (const dir of ['data', 'assets/css', 'assets/images', 'assets/js', 'assets/json', 'assets/vendor']) {
        cpSync(resolve(root, dir), resolve(root, 'dist', dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        viewer: resolve(root, 'index.html'),
        print: resolve(root, 'print.html'),
      },
    },
  },
  plugins: [rawGzip(), copyStatic()],
});
