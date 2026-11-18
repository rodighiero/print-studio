import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutCentre, sheetGeometry } from '../assets/print/render.js';

test('layout centre ignores a few stray points at the layout edges', () => {
  // 1000 points spread over x 0..0.4, y -0.6..-0.2, plus two outliers at the corners.
  const xy = [];
  for (let i = 0; i < 1000; i++) xy.push(0.4 * i / 999, -0.6 + 0.4 * i / 999);
  xy.push(-1, 1, 1, -1);
  const [x, y] = layoutCentre(new Float32Array(xy));
  assert.ok(Math.abs(x - 0.2) < 0.01, `x ${x}`);
  assert.ok(Math.abs(y + 0.4) < 0.01, `y ${y}`);
});

test('layout centre frames out a small group detached from the main body', () => {
  // Main body: y from -0.2 to 0.6 (centre 0.2). A detached group of 10% near y = -0.8.
  const xy = [];
  for (let i = 0; i < 900; i++) xy.push(0, -0.2 + 0.8 * i / 899);
  for (let i = 0; i < 100; i++) xy.push(0, -0.82 + 0.04 * i / 99);
  // Stray points just above the group must not pull the main body's centre down.
  for (let i = 0; i < 4; i++) xy.push(0, -0.6 + 0.05 * i);
  const [, y] = layoutCentre(new Float32Array(xy));
  assert.ok(Math.abs(y - 0.2) < 0.01, `y ${y}`);
});

test('with zero offsets the image centre lands on the sheet centre', () => {
  const p = { sheet: [420, 594], zoom: 2, offsetX: 0, offsetY: 0, centre: [0.18, -0.07] };
  const g = sheetGeometry(p);
  assert.ok(Math.abs(g.cx + p.centre[0] * g.half - 210) < 1e-9);
  assert.ok(Math.abs(g.cy - p.centre[1] * g.half - 297) < 1e-9);
});
