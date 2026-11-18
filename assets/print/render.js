// Draws the design as RGBA before ink separation, preserving mark coverage.
// Everything is placed in sheet millimeters, so the same params render identically
// at any dpi and for any crop ("view") of the sheet.
//
// view = { dpi, x0, y0, w, h }  -> pixel window of the sheet at `dpi`

// Fallback before the layout loads: the original Surprise Machines viewer's
// camera target, World.getInitialLocation() in
// https://github.com/rodighiero/surprise-machines/blob/main/assets/js/tsne.js
const VIEWER_CENTRE = [0.2, 0.1];

// Centre of the image's main body, per axis: the middle of the box holding the
// central 99% of points, so stray points at the layout edges are ignored. A
// small group detached from the rest at either end (at most `tail` of the
// points, beyond an empty band wider than `gap` layout units) is framed out
// too: centring on the main body pushes it towards the sheet edge.
export function layoutCentre(xy, { trim = 0.005, tail = 0.2, gap = 0.05 } = {}) {
  const n = xy.length / 2;
  if (!n) return [...VIEWER_CENTRE];
  return [0, 1].map((axis) => {
    const values = new Float32Array(n);
    for (let i = 0; i < n; i++) values[i] = xy[2 * i + axis];
    values.sort();
    let lo = Math.round(trim * (n - 1));
    let hi = Math.round((1 - trim) * (n - 1));
    const span = Math.floor(tail * n);
    // Widest empty band within the outer `tail` of points at each end.
    let low = { width: 0, at: lo }, high = { width: 0, at: hi };
    for (let i = lo; i < Math.min(hi, lo + span); i++) {
      if (values[i + 1] - values[i] > low.width) low = { width: values[i + 1] - values[i], at: i + 1 };
    }
    for (let i = hi; i > Math.max(lo, hi - span); i--) {
      if (values[i] - values[i - 1] > high.width) high = { width: values[i] - values[i - 1], at: i - 1 };
    }
    // Drop a detached group, then trim stray points again within what remains.
    let start = 0, end = n - 1;
    if (low.width > gap) start = low.at;
    if (high.width > gap) end = high.at;
    const count = end - start;
    lo = start + Math.round(trim * count);
    hi = end - Math.round(trim * count);
    return (values[lo] + values[hi]) / 2;
  });
}

export function sheetGeometry(p) {
  const [W, H] = p.sheet;
  const side = Math.min(W, H) * p.zoom; // plot square, mm
  const half = side / 2;
  // Offsets are 0 when the image centre sits on the sheet centre.
  // Layout y increases upwards; sheet y increases downwards.
  const [x0, y0] = p.centre ?? VIEWER_CENTRE;
  const cx = W / 2 + p.offsetX - x0 * half;
  const cy = H / 2 + p.offsetY + y0 * half;
  return { W, H, side, half, cx, cy };
}

export function fullView(p, dpi) {
  const k = dpi / 25.4;
  return { dpi, x0: 0, y0: 0, w: Math.round(p.sheet[0] * k), h: Math.round(p.sheet[1] * k) };
}

// Films extend past the sheet by a bleed that carries the registration marks,
// unless the bleed is turned off (p.bleed === false): then a film is the sheet.
export const BLEED_MM = 10;
export function filmView(p, dpi) {
  const sheet = fullView(p, dpi);
  if (p.bleed === false) return sheet;
  const b = Math.round(BLEED_MM * dpi / 25.4);
  return { dpi, x0: -b, y0: -b, w: sheet.w + 2 * b, h: sheet.h + 2 * b, trim: { w: sheet.w, h: sheet.h } };
}

// Original viewer: scalar * canvas.clientHeight * 0.00001, applied to
// each image's cell dimensions. Its canvas extends 10 px above and 60 px
// below the window (assets/css/style.css), so height = window height + 70.
// Convert world units to sheet mm using the same scale as image positions.
export function originalImageScale(ds, p) {
  const rawScalar = ds.pointSizes.scatter;
  // The source assigns rawScalar / devicePixelRatio to a range input with
  // step=0.00001, then multiplies its rounded value by devicePixelRatio.
  const ratio = p.referencePixelRatio;
  const scalar = Math.round(rawScalar / ratio / 0.00001) * 0.00001 * ratio;
  return scalar * (p.referenceHeight + 70) * 0.00001 * sheetGeometry(p).half;
}

// Mean rendered thumbnail area, converted to physical sheet units.
export function originalMarkArea(ds, p) {
  return originalImageScale(ds, p) ** 2 * ds.meanCellArea;
}

export function renderDesign(ds, xy, p, view) {
  const canvas = new OffscreenCanvas(view.w, view.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Keep artwork coverage separate from its color. Blending tiny marks
  // into white here makes flat spot separation mistake them for paper.

  const k = view.dpi / 25.4;
  const g = sheetGeometry(p);
  // The artwork never spills past the sheet edge (into the film bleed).
  const sheet = fullView(p, view.dpi);
  ctx.beginPath();
  ctx.rect(-view.x0, -view.y0, sheet.w, sheet.h);
  ctx.clip();

  // markSize scales the mark diameter relative to the original viewer.
  const area = originalMarkArea(ds, p) * k * k * (p.markSize ?? 1) ** 2;
  const radius = Math.sqrt(area / Math.PI);
  const pad = radius * 2;
  for (let i = 0; i < ds.n; i++) {
    const x = (g.cx + xy[2 * i] * g.half) * k - view.x0;
    const y = (g.cy - xy[2 * i + 1] * g.half) * k - view.y0;
    if (x < -pad || y < -pad || x > view.w + pad || y > view.h + pad) continue;

    const weight = p.sizeBy === 'darkness' ? Math.max(0, 1 - ds.lum[i]) : 1;
    if (weight <= 0) continue;
    const r = radius * Math.sqrt(weight);
    ctx.fillStyle = markColor(ds, i, p);
    if (r < 0.75) {
      // At subpixel scale, preserve exact area with an antialiased footprint.
      const side = Math.sqrt(area * weight);
      ctx.fillRect(x - side / 2, y - side / 2, side, side);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return ctx.getImageData(0, 0, view.w, view.h);
}

function markColor(ds, i, p) {
  switch (p.colorBy) {
    case 'image': return ds.css[i];
    case 'tone': {
      const v = Math.round(ds.lum[i] * 255);
      return `rgb(${v},${v},${v})`;
    }
    default: return '#000';
  }
}

export function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
