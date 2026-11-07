// Draws the design as RGBA before ink separation, preserving mark coverage.
// Everything is placed in sheet millimeters, so the same params render identically
// at any dpi and for any crop ("view") of the sheet.
//
// view = { dpi, x0, y0, w, h }  -> pixel window of the sheet at `dpi`

// Match World.getInitialLocation() in the original Surprise Machines viewer:
// https://github.com/rodighiero/surprise-machines/blob/main/assets/js/tsne.js
const NETWORK_CENTRE = { x: 0.2, y: 0.1 };

export function sheetGeometry(p) {
  const [W, H] = p.sheet;
  const side = Math.min(W, H) * p.zoom; // plot square, mm
  const half = side / 2;
  // Layout y increases upwards; sheet y increases downwards.
  const cx = W / 2 + p.offsetX - NETWORK_CENTRE.x * half;
  const cy = H / 2 + p.offsetY + NETWORK_CENTRE.y * half;
  return { W, H, side, half, cx, cy };
}

export function fullView(p, dpi) {
  const k = dpi / 25.4;
  return { dpi, x0: 0, y0: 0, w: Math.round(p.sheet[0] * k), h: Math.round(p.sheet[1] * k) };
}

// Films extend past the sheet by a bleed that carries the registration marks.
export const BLEED_MM = 10;
export function filmView(p, dpi) {
  const sheet = fullView(p, dpi);
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

  const area = originalMarkArea(ds, p) * k * k;
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
