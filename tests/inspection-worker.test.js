import test from 'node:test';
import assert from 'node:assert/strict';

test('inspection worker returns original colors when preview is off and real film pixels when on', async t => {
  const messages = [];
  const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  t.after(() => {
    if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf);
    else delete globalThis.self;
    if (originalCanvas) Object.defineProperty(globalThis, 'OffscreenCanvas', originalCanvas);
    else delete globalThis.OffscreenCanvas;
  });
  globalThis.self = { postMessage: message => messages.push(message) };
  const rgba = new Uint8ClampedArray([0, 0, 255, 64, 255, 255, 255, 0]);
  globalThis.OffscreenCanvas = class {
      getContext() {
        return {
          beginPath() {}, rect() {}, clip() {},
          getImageData: () => ({ width: 2, height: 1, data: rgba.slice() }),
        };
      }
    };
  await import('../assets/print/preview-worker.js');
  await self.onmessage({ data: {
    type: 'init', dataset: { n: 0, meanCellArea: 1, pointSizes: { scatter: 0.001 } }, positions: [],
  } });
  const p = {
    sheet: [420, 594], dpi: 300, zoom: 1, offsetX: 0, offsetY: 0,
    referenceHeight: 900, referencePixelRatio: 1,
    inkMode: 'spot', spotMethod: 'flat', inks: ['#0000ff'], paper: '#ffffff',
  };
  const view = { dpi: 300, x0: 0, y0: 0, w: 2, h: 1 };
  const render = async data => {
    await self.onmessage({ data: { id: messages.length + 1, p, view, ...data } });
    const result = messages.at(-1);
    assert.ok(!result.error, result.error);
    return result.preview;
  };
  const original = await render({ type: 'inspect', printPreview: false });
  assert.deepEqual(original.design.data, rgba);
  assert.equal(original.layers.length, 0);
  const detail = await render({ type: 'inspect', printPreview: true });
  assert.ok([...detail.layers[0].data].every(value => value === 0 || value === 255));
  const preview = await render({});
  assert.equal(preview.layers[0].data[0], 64);
});
