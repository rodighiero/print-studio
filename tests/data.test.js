import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from '../assets/print/data.js';

test('the studio loads source colors and layout without requiring obsolete cluster hotspots', async t => {
  const saved = Object.fromEntries(['fetch', 'Image', 'OffscreenCanvas'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const requests = [];
  const fixtures = {
    'data/manifest.json': {
      imagelist: 'output/data/images.json', config: { sizes: { cell: 1 } },
      atlas_dir: 'output/data/atlases', point_sizes: { scatter: 0.001 },
      layouts: { umap: { variants: [{ layout: 'output/data/umap.json' }] } },
    },
    'data/images.json': { cell_sizes: [[[1, 1]]], atlas: { positions: [[[0, 0]]] } },
    'data/umap.json': [[0.2, 0.1]],
  };
  globalThis.fetch = async path => {
    requests.push(path);
    assert.ok(path in fixtures, `Unexpected data dependency: ${path}`);
    return new Response(JSON.stringify(fixtures[path]));
  };
  globalThis.Image = class {
    width = 1; height = 1;
    async decode() { assert.equal(this.src, 'data/atlases/atlas-0.jpg'); }
  };
  globalThis.OffscreenCanvas = class {
    getContext() { return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([20, 30, 40, 255]) }) }; }
  };
  const data = await loadDataset();
  assert.equal(data.n, 1);
  assert.deepEqual([...data.color], [20, 30, 40]);
  assert.deepEqual(data.css, ['rgb(20,30,40)']);
  const layout = await data.layout('umap');
  assert.ok(Math.abs(layout[0] - 0.2) < 1e-7);
  assert.equal(await data.layout('umap'), layout);
  assert.deepEqual(requests, ['data/manifest.json', 'data/images.json', 'data/umap.json']);
});
