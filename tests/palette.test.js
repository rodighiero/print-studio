import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette } from '../assets/print/palette.js';

const samples = groups => new Uint8ClampedArray(groups.flatMap(([rgb, count]) => Array.from({ length: count }, () => rgb).flat()));

test('three inks recover three original color groups without adding preset colors', () => {
  const colors = samples([[[255, 0, 0], 60], [[0, 0, 255], 30], [[0, 255, 0], 10]]);
  assert.deepEqual(new Set(extractPalette(colors, 3)), new Set(['#ff0000', '#0000ff', '#00ff00']));
  const two = extractPalette(colors, 2);
  assert.equal(two.length, 2);
  assert.notDeepEqual(two, extractPalette(colors, 3).slice(0, 2));
  assert.ok(two.some(color => !extractPalette(colors, 3).includes(color)), 'two inks must be optimized independently');
});

test('palette colors reflect artwork frequency rather than giving every histogram bin equal weight', () => {
  const colors = samples([[[0, 0, 0], 3], [[255, 255, 255], 1]]);
  assert.deepEqual(extractPalette(colors, 1), ['#404040']);
});

test('palette generation is deterministic regardless of artwork order', () => {
  const groups = [[[12, 40, 80], 100], [[210, 180, 150], 40], [[150, 30, 60], 10], [[90, 100, 80], 20]];
  for (const count of [2, 3]) {
    const first = extractPalette(samples(groups), count);
    const reversed = extractPalette(samples([...groups].reverse()), count);
    assert.deepEqual(first, reversed);
    assert.equal(new Set(first).size, count);
    assert.ok(first.every(color => /^#[0-9a-f]{6}$/.test(color)));
  }
});

test('monochrome source colors do not introduce artificial hues or invalid inks', () => {
  assert.deepEqual(extractPalette(new Uint8ClampedArray([32, 64, 96]), 3), ['#204060', '#204060', '#204060']);
  const colors = samples([[[20, 20, 20], 30], [[120, 120, 120], 20], [[220, 220, 220], 10]]);
  for (const color of extractPalette(colors, 2)) {
    assert.equal(color.slice(1, 3), color.slice(3, 5));
    assert.equal(color.slice(3, 5), color.slice(5, 7));
  }
});
