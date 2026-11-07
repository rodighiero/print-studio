import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { originalImageScale, originalMarkArea, renderDesign } from '../assets/print/render.js';

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);
const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url)));
const imageList = JSON.parse(gunzipSync(readFileSync(new URL(`../${manifest.imagelist.replace(/^output\//, '')}`, import.meta.url))));
const dimensions = imageList.cell_sizes.flat();
const meanCellArea = dimensions.reduce((sum, [w, h]) => sum + w * h, 0) / dimensions.length;
const ds = {
  n: 3, meanCellArea, pointSizes: manifest.point_sizes,
  css: ['#123456', '#abcdef', '#335577'], lum: [0, 0.25, 1],
};
const base = {
  sheet: [420, 594], zoom: 1, offsetX: 0, offsetY: 0,
  referenceHeight: 949, referencePixelRatio: 2,
  colorBy: 'image', sizeBy: 'constant', render: 'dots',
};

function draw(t, p, dpi = 300, crop = 0) {
  const marks = [];
  globalThis.OffscreenCanvas ??= function () {};
  t.mock.method(globalThis, 'OffscreenCanvas', function () {
    let circle;
    const ctx = {
      fillRect(x, y, w, h) { marks.push({ x: x + w / 2, y: y + h / 2, area: w * h, color: ctx.fillStyle, kind: 'coverage', side: w }); },
      beginPath() { circle = null; },
      rect() {},
      clip() {},
      arc(x, y, r) { circle = { x, y, area: Math.PI * r * r, radius: r, kind: 'circle' }; },
      fill() { marks.push({ ...circle, color: ctx.fillStyle }); },
      getImageData() { return {}; },
    };
    this.getContext = () => ctx;
  });
  renderDesign(ds, [0.2,0.1, 0.3,0.1, 0.4,0.1], p, { dpi, x0: crop, y0: crop, w: 20000, h: 20000 });
  return marks;
}

test('original sizing includes the source slider rounding on standard and Retina displays', () => {
  for (const [referencePixelRatio, scalar] of [[1, 0.00043], [2, 0.00044], [3, 0.00042]]) {
    near(originalImageScale(ds, { ...base, referencePixelRatio }), scalar * 1019 * 0.00001 * 210);
  }
});

test('reference area is the actual collection mean and is unchanged by portrait/landscape orientation', () => {
  const transposedMean = dimensions.reduce((sum, [w, h]) => sum + h * w, 0) / dimensions.length;
  near(transposedMean, meanCellArea);
  const scale = 0.00044 * 1019 * 0.00001 * 210;
  const originalTotal = dimensions.reduce((sum, [w, h]) => sum + w * h * scale ** 2, 0);
  near(dimensions.length * originalMarkArea(ds, base) / originalTotal, 1);
});

test('dots preserve the original mean area at all sheet sizes, zooms and dpi', t => {
  for (const sheet of [[420, 594], [297, 420]]) {
    for (const zoom of [1, 2, 2.5]) {
      for (const dpi of [60, 300, 400]) {
        const k = dpi / 25.4;
        const scale = 0.00044 * 1019 * 0.00001 * Math.min(...sheet) / 2 * zoom;
        const expectedArea = meanCellArea * scale ** 2 * k ** 2;
        const render = 'dots';
        const marks = draw(t, { ...base, render, sheet, zoom }, dpi);
        assert.equal(marks.length, ds.n);
        for (let i = 0; i < ds.n; i++) {
          near(marks[i].area, expectedArea);
          assert.equal(marks[i].color, ds.css[i]);
        }
        near(marks[0].x, sheet[0] / 2 * k);
        near(marks[0].y, sheet[1] / 2 * k);

      }
    }
  }
});

test('doubling zoom quadruples area while diameter doubles', t => {
  const render = 'dots';
  const first = draw(t, { ...base, render }, 400);
  const enlarged = draw(t, { ...base, render, zoom: 2 }, 400);
  near(enlarged[0].area, first[0].area * 4);
  const length = mark => mark.kind === 'circle' ? mark.radius * 2 : mark.side;
  near(length(enlarged[0]), length(first[0]) * 2);
  near(enlarged[1].x - enlarged[0].x, 2 * (first[1].x - first[0].x));

});

test('darkness scales dot area and fully white images use no ink', t => {
  const render = 'dots';
  const constant = draw(t, { ...base, render });
  const weighted = draw(t, { ...base, render, sizeBy: 'darkness' });
  assert.equal(weighted.length, 2);
  near(weighted[0].area, constant[0].area);
  near(weighted[1].area, constant[1].area * 0.75);

});

test('preview and cropped detail/export keep the same physical areas and positions', t => {
  const render = 'dots';
  const preview = draw(t, { ...base, render }, 60);
  const full = draw(t, { ...base, render }, 400);
  const cropped = draw(t, { ...base, render }, 400, 100);
  for (let i = 0; i < ds.n; i++) {
    near(full[i].area / preview[i].area, (400 / 60) ** 2);
    near(cropped[i].area, full[i].area);
    near(cropped[i].x, full[i].x - 100);
    near(cropped[i].y, full[i].y - 100);
  }

});

test('subpixel dots keep the original area instead of using an oversized bounding square', t => {
  const [dot] = draw(t, base, 60);
  assert.equal(dot.kind, 'coverage');
  assert.ok(dot.side < 1 && dot.side > 0);
  near(dot.area, originalMarkArea(ds, base) * (60 / 25.4) ** 2);
});

test('dot color controls work; old manual sizes are ignored', t => {
  const render = 'dots';
  const image = draw(t, { ...base, render, size: 0.001 });
  const oldLargeSize = draw(t, { ...base, render, size: 20 });
  near(image[0].area, oldLargeSize[0].area);
  assert.equal(draw(t, { ...base, render, colorBy: 'tone' })[0].color, 'rgb(0,0,0)');
  assert.equal(draw(t, { ...base, render, colorBy: 'solid' })[0].color, '#000');

});

test('panel and committed defaults contain only automatic dots', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const settings = JSON.parse(readFileSync(new URL('../studio-settings.json', import.meta.url)));
  assert.ok(!html.includes('value="thumbs"'));
  assert.ok(!html.includes('value="squares"'));
  assert.ok(!html.includes('name="render"'));
  assert.equal(settings.values.render, 'dots');
  assert.ok(!html.includes('name="size"'));
  assert.ok(!('size' in settings.values));
  assert.ok(!html.includes('<legend>Dot area</legend>'));
  assert.ok(!html.includes('<legend>Mark area</legend>'));
  assert.ok(!html.includes('name="sizeBy"'));
  assert.equal(settings.values.sizeBy, 'constant');
});
