import test from 'node:test';
import assert from 'node:assert/strict';
import { separate, addMarks } from '../assets/print/separate.js';

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

test('flat spot preview keeps thumbnail coverage; films are pure black/white', () => {
  const p = { inkMode: 'spot', spotMethod: 'flat', inks: ['#0000ff'], paper: '#ffffff' };
  const [preview] = separate(img, p, view, true);
  assert.deepEqual([...preview.data], [4, 0, 0, 255]);
  const [filmLayer] = separate(img, p, view, false);
  assert.ok([...filmLayer.data].every(v => v === 0 || v === 255));
  assert.deepEqual([...filmLayer.data].slice(1), [0, 0, 255]);
});

function uniform(w, h, rgba) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { width: w, height: h, data };
}

test('film density matches partial coverage, so tiny thumbnails do not vanish', () => {
  const w = 256, h = 256, v = { dpi: 300, x0: 0, y0: 0, w, h };
  for (const a of [4, 64, 191]) {
    const [L] = separate(uniform(w, h, [0, 0, 255, a]), { inkMode: 'spot', spotMethod: 'flat', inks: ['#0000ff'], paper: '#ffffff' }, v, false);
    const density = L.data.reduce((s, x) => s + x, 0) / 255 / (w * h);
    assert.ok(Math.abs(density - a / 255) < 0.01, `alpha ${a}: density ${density}`);
  }
});

test('a crop (the loupe) matches the same area of the full export for every screen', () => {
  const W = 120, H = 90;
  const full = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) full.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, (i * 11) % 256], i * 4);
  const crop = (x0, y0, w, h) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) d.set(full.subarray(((y + y0) * W + x0) * 4, ((y + y0) * W + x0 + w) * 4), y * w * 4);
    return { width: w, height: h, data: d };
  };
  const modes = [
    { inkMode: 'mono', inks: ['#000000'], screen: 'fs' },
    { inkMode: 'mono', inks: ['#000000'], screen: 'am', lpi: 35, angle: 22.5 },
    { inkMode: 'cmyk', gcr: 1, screen: 'fs' },
    { inkMode: 'spot', spotMethod: 'dither', inks: ['#e4572e', '#1b4f9c'], paper: '#f4f0e6' },
    { inkMode: 'spot', spotMethod: 'flat', inks: ['#e4572e', '#1b4f9c'], paper: '#f4f0e6' },
  ];
  const [x0, y0, w, h] = [37, 21, 50, 40];
  for (const p of modes) {
    const a = separate({ width: W, height: H, data: full }, p, { dpi: 300, x0: 0, y0: 0, w: W, h: H }, false);
    const b = separate(crop(x0, y0, w, h), p, { dpi: 300, x0, y0, w, h }, false);
    for (const [j, L] of b.entries()) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          assert.equal(L.data[y * w + x], a[j].data[(y + y0) * W + x + x0], `${p.inkMode}/${p.screen ?? p.spotMethod} ${L.name} at ${x},${y}`);
        }
      }
    }
  }
});

test('spot separation treats colors near the paper as paper, not ink', () => {
  const cream = uniform(2, 1, [244, 240, 230, 255]);
  const p = { inkMode: 'spot', spotMethod: 'flat', inks: ['#e4572e'], paper: '#f4f0e6' };
  assert.deepEqual([...separate(cream, p, { dpi: 300, x0: 0, y0: 0, w: 2, h: 1 }, false)[0].data], [0, 0]);
});

test('registration marks are drawn in the bleed of every film, never on the sheet', () => {
  const b = 118, tw = 300, th = 400; // 10 mm bleed at 300 dpi
  const v = { dpi: 300, x0: -b, y0: -b, w: tw + 2 * b, h: th + 2 * b, trim: { w: tw, h: th } };
  const layers = [0, 1, 2].map(() => ({ data: new Uint8Array(v.w * v.h) }));
  addMarks(layers, v);
  for (const L of layers) {
    assert.deepEqual(L.data, layers[0].data);
    let inBleed = 0;
    for (let y = 0; y < v.h; y++) {
      for (let x = 0; x < v.w; x++) {
        if (!L.data[y * v.w + x]) continue;
        assert.ok(!(x >= b && x < b + tw && y >= b && y < b + th), `mark on the sheet at ${x},${y}`);
        inBleed++;
      }
    }
    assert.ok(inBleed > 0);
  }
  // Each center target sits on the sheet's center line.
  assert.equal(layers[0].data[Math.round(b / 2) * v.w + b + tw / 2], 255);
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

test('AM screening rejects an invalid frequency instead of exporting blank or solid films', () => {
  const black = { width: 4, height: 1, data: new Uint8ClampedArray(16).fill(255) };
  for (const lpi of [NaN, 0]) {
    assert.throws(() => separate(black, { inkMode: 'mono', inks: ['#000000'], screen: 'am', lpi, angle: 22.5 }, view, false));
  }
});
