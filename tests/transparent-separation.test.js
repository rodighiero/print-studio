import test from 'node:test';
import assert from 'node:assert/strict';
import { separate } from '../assets/print/separate.js';

const view = { dpi: 300, x0: 0, y0: 0, w: 4, h: 1 };
const img = {
  width: 4, height: 1,
  data: new Uint8ClampedArray([
    0, 0, 255, 4,       // Tiny blue thumbnail: 4/255 pixel coverage.
    0, 0, 0, 0,         // Untouched transparent canvas.
    255, 255, 255, 255, // White artwork content.
    0, 0, 255, 255,     // Opaque blue artwork.
  ]),
};

test('flat spot separation retains tiny thumbnail coverage in preview and export', () => {
  const p = { inkMode: 'spot', spotMethod: 'flat', inks: ['#0000ff'] };
  for (const simulate of [true, false]) {
    const [blue] = separate(img, p, view, simulate);
    assert.deepEqual([...blue.data], [4, 0, 0, 255]);
  }
});

test('transparent canvas adds no ink in mono, CMYK or dithered spot output', () => {
  const blank = { width: 4, height: 1, data: new Uint8ClampedArray(16) };
  const modes = [
    { inkMode: 'mono', inks: ['#000000'], screen: 'threshold' },
    { inkMode: 'cmyk', gcr: 1, screen: 'threshold' },
    { inkMode: 'spot', spotMethod: 'dither', inks: ['#0000ff'] },
  ];
  for (const p of modes) {
    for (const simulate of [true, false]) {
      for (const layer of separate(blank, p, view, simulate)) {
        assert.deepEqual([...layer.data], [0, 0, 0, 0]);
      }
    }
  }
});

test('mono and CMYK preserve fractional mark coverage without an opaque background', () => {
  const black = { width: 4, height: 1, data: new Uint8ClampedArray([0,0,0,4, 0,0,0,0, 255,255,255,255, 0,0,0,255]) };
  const [mono] = separate(black, { inkMode: 'mono', inks: ['#000000'] }, view, true);
  assert.deepEqual([...mono.data], [4, 0, 0, 255]);
  const layers = separate(black, { inkMode: 'cmyk', gcr: 1 }, view, true);
  assert.deepEqual([...layers.find(layer => layer.name === 'K').data], [4, 0, 0, 255]);
  for (const layer of layers.filter(layer => layer.name !== 'K')) assert.deepEqual([...layer.data], [0, 0, 0, 0]);
});
