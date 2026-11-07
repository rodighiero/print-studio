import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectionView } from '../assets/print/inspection.js';
import { fullView } from '../assets/print/render.js';

test('inspection square stays inside every sheet at all selectable export resolutions', () => {
  for (const sheet of [[420, 594], [297, 420]]) {
    for (const dpi of [300, 400]) {
      const p = { sheet, dpi };
      const full = fullView(p, dpi);
      for (const centre of [[0, 0], [1, 1], [0.5, 0.5], [-0.1, 1.1]]) {
        const view = inspectionView(p, centre, 600);
        assert.equal(view.w, 600);
        assert.equal(view.h, 600);
        assert.ok(Number.isInteger(view.x0) && Number.isInteger(view.y0));
        assert.ok(view.x0 >= 0 && view.x0 + view.w <= full.w);
        assert.ok(view.y0 >= 0 && view.y0 + view.h <= full.h);
      }
    }
  }
});

test('inspection cursor and detail use the same crop independent of composition zoom', () => {
  const p = { sheet: [420, 594], dpi: 300, zoom: 1 };
  const centre = [0.3, 0.7];
  const view = inspectionView(p, centre, 600);
  const full = fullView(p, p.dpi);
  assert.ok(Math.abs((view.x0 + 300) / full.w - centre[0]) <= 0.5 / full.w);
  assert.ok(Math.abs((view.y0 + 300) / full.h - centre[1]) <= 0.5 / full.h);
  assert.deepEqual(inspectionView({ ...p, zoom: 2.5 }, centre, 600), view);
});
