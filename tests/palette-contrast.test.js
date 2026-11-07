import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastPalette, hexToOklab } from '../assets/print/palette-contrast.js';

function minimumColorDistance(palette) {
  const labs = palette.map(hexToOklab);
  let distance = Infinity;
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      distance = Math.min(distance, Math.hypot(labs[i][1] - labs[j][1], labs[i][2] - labs[j][2]));
    }
  }
  return distance;
}

test('both muted spot palettes gain color separation without increasing their lightness or saturation', () => {
  for (const original of [['#786552', '#b29a7e'], ['#786552', '#a18a70', '#c7b49a']]) {
    const enhanced = contrastPalette(original);
    assert.equal(enhanced.length, original.length);
    assert.ok(minimumColorDistance(enhanced) > minimumColorDistance(original) * 1.5);
    enhanced.forEach((hex, i) => {
      const before = hexToOklab(original[i]), after = hexToOklab(hex);
      assert.ok(Math.abs(after[0] - before[0]) < 0.002, 'preserve perceived lightness');
      assert.ok(Math.abs(Math.hypot(after[1], after[2]) - Math.hypot(before[1], before[2])) < 0.002, 'preserve chroma');
    });
  }
});

test('neutral, uniform and already distinct palettes retain their original colors', () => {
  for (const palette of [
    ['#222222', '#999999', '#eeeeee'],
    ['#204060', '#204060'],
    ['#ff0000', '#00ff00', '#0000ff'],
  ]) assert.deepEqual(contrastPalette(palette), palette);
});

test('high-saturation hue changes remain in gamut without shifting brightness', () => {
  const original = ['#ff3300', '#ff5500', '#ff7700'];
  const enhanced = contrastPalette(original);
  enhanced.forEach((color, i) => {
    assert.match(color, /^#[0-9a-f]{6}$/);
    assert.ok(Math.abs(hexToOklab(color)[0] - hexToOklab(original[i])[0]) < 0.002);
  });
  assert.ok(minimumColorDistance(enhanced) > minimumColorDistance(original));
});
