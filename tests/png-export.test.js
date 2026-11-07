import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { filmPng } from '../assets/print/export.js';

function chunks(buf) {
  const out = {};
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    out[type] = buf.subarray(o + 8, o + 8 + len);
    o += 12 + len;
  }
  return out;
}

test('films encode losslessly as 8-bit grayscale with the export dpi', async () => {
  const w = 5, h = 3;
  const data = Uint8Array.from({ length: w * h }, (_, i) => (i % 3 ? 0 : 255));
  const png = Buffer.from(await (await filmPng({ data }, { w, h }, 300)).arrayBuffer());
  const c = chunks(png);
  assert.equal(c.IHDR.readUInt32BE(0), w);
  assert.equal(c.IHDR.readUInt32BE(4), h);
  assert.deepEqual([c.IHDR[8], c.IHDR[9]], [8, 0]);
  assert.equal(c.pHYs.readUInt32BE(0), Math.round(300 / 0.0254));
  const raw = inflateSync(c.IDAT);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w + 1)], 0);
    for (let x = 0; x < w; x++) assert.equal(raw[y * (w + 1) + 1 + x], 255 - data[y * w + x]);
  }
});
