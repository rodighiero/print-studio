import test from 'node:test';
import assert from 'node:assert/strict';
import { drawMotionPreview } from '../assets/print/motion-preview.js';

const sheet = { sheet: [420, 594], zoom: 1, offsetX: 0, offsetY: 0 };
const snapshot = { width: 840, height: 1188 };
function draw(previous, current, background) {
  const calls = [];
  const ctx = {
    fillRect(...args) { calls.push(['paper', this.fillStyle, ...args]); },
    drawImage(...args) { calls.push(['artwork', ...args]); },
  };
  drawMotionPreview(ctx, snapshot, previous, current, background);
  return calls;
}

test('zoom keeps the paper fixed and scales the proof around the sheet center', () => {
  const calls = draw(sheet, { ...sheet, zoom: 2 }, '#f4f0e6');
  assert.deepEqual(calls[0], ['paper', '#f4f0e6', 0, 0, 840, 1188]);
  assert.deepEqual(calls[1], ['artwork', snapshot, -420, -594, 1680, 2376]);
});

test('zoom out and drag refill exposed film paper without moving the sheet', () => {
  const calls = draw({ ...sheet, zoom: 2 }, { ...sheet, offsetX: 10, offsetY: -5 }, '#ffffff');
  assert.deepEqual(calls[0], ['paper', '#ffffff', 0, 0, 840, 1188]);
  assert.deepEqual(calls[1], ['artwork', snapshot, 230, 287, 420, 594]);
});
