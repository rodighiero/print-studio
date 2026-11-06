// Draws the "design": an RGB image on white, before ink separation.
// Everything is placed in sheet millimetres, so the same params render identically
// at any dpi and for any crop ("view") of the sheet.
//
// view = { dpi, x0, y0, w, h }  -> pixel window of the sheet at `dpi`

export const CATEGORICAL = [
  '#e4572e', '#1b4f9c', '#f2a541', '#2e8b57', '#8e44ad',
  '#17becf', '#c0392b', '#7f8c8d', '#d35400', '#34495e',
];

export function sheetGeometry(p) {
  const [W, H] = p.sheet;
  const side = (Math.min(W, H) - 2 * p.margin) * p.zoom; // plot square, mm
  return { W, H, side, half: side / 2, cx: W / 2 + p.offsetX, cy: H / 2 + p.offsetY };
}

export function fullView(p, dpi) {
  const k = dpi / 25.4;
  return { dpi, x0: 0, y0: 0, w: Math.round(p.sheet[0] * k), h: Math.round(p.sheet[1] * k) };
}

export function renderDesign(ds, xy, p, view, palette) {
  const canvas = new OffscreenCanvas(view.w, view.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, view.w, view.h);

  const k = view.dpi / 25.4;
  const g = sheetGeometry(p);

  if (p.render === 'density') {
    ctx.putImageData(renderDensity(ds, xy, p, view, palette), 0, 0);
  } else {
    const s = p.size * k;
    const pad = s * 2;
    for (let i = 0; i < ds.n; i++) {
      const x = (g.cx + xy[2 * i] * g.half) * k - view.x0;
      const y = (g.cy - xy[2 * i + 1] * g.half) * k - view.y0;
      if (x < -pad || y < -pad || x > view.w + pad || y > view.h + pad) continue;

      if (p.render === 'thumbs') {
        const a = ds.aspect[i];
        const dw = a >= 1 ? s : s * a;
        const dh = a >= 1 ? s / a : s;
        ctx.drawImage(ds.atlases[ds.atlasIdx[i]], ds.sx[i], ds.sy[i], ds.sw[i], ds.cellPx,
          x - dw / 2, y - dh / 2, dw, dh);
      } else {
        const r = (s / 2) * (p.sizeBy === 'darkness' ? Math.sqrt(1 - ds.lum[i]) : 1);
        if (r < 0.05) continue;
        ctx.fillStyle = dotColor(ds, i, p, palette);
        if (r < 0.75) {
          ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  if (p.caption) {
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${p.captionSize * k}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    ctx.fillText(p.caption, p.margin * k - view.x0, (g.H - p.margin) * k - view.y0);
  }

  return ctx.getImageData(0, 0, view.w, view.h);
}

function dotColor(ds, i, p, palette) {
  switch (p.colorBy) {
    case 'image': return ds.css[i];
    case 'tone': {
      const v = Math.round(ds.lum[i] * 255);
      return `rgb(${v},${v},${v})`;
    }
    case 'cluster': {
      const c = ds.cluster[i];
      return c < 0 ? '#999' : palette[c % palette.length];
    }
    default: return '#000';
  }
}

/* ---------- density field ---------- */

const G = 1024; // grid resolution over the plot square
let densityCache = { key: null, field: null };

function boxBlur(src, tmp, r) {
  // horizontal then vertical running-sum box blur, radius r (cells)
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < G; y++) {
    const row = y * G;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(G - 1, Math.max(0, x))];
    for (let x = 0; x < G; x++) {
      tmp[row + x] = acc * norm;
      acc += src[row + Math.min(G - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < G; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(G - 1, Math.max(0, y)) * G + x];
    for (let y = 0; y < G; y++) {
      src[y * G + x] = acc * norm;
      acc += tmp[Math.min(G - 1, y + r + 1) * G + x] - tmp[Math.max(0, y - r) * G + x];
    }
  }
}

function gaussian(grid, sigmaCells) {
  if (sigmaCells < 0.5) return;
  // three box passes ≈ gaussian; variance of one pass = r(r+1)/3
  const r = Math.max(1, Math.round(Math.sqrt(sigmaCells * sigmaCells + 0.25) - 0.5));
  const tmp = new Float32Array(G * G);
  for (let pass = 0; pass < 3; pass++) boxBlur(grid, tmp, r);
}

function densityField(ds, xy, p) {
  const g = sheetGeometry(p);
  const sigma = p.blur / (g.side / G);
  const key = [p.layout, sigma.toFixed(3), p.colorBy].join('|');
  if (densityCache.key === key) return densityCache.field;

  const total = new Float32Array(G * G);
  const byCluster = p.colorBy === 'cluster';
  const byImage = p.colorBy === 'image';
  const K = ds.clusterLabels.length;
  const clusters = byCluster ? Array.from({ length: K }, () => new Float32Array(G * G)) : null;
  const rgb = byImage ? [0, 1, 2].map(() => new Float32Array(G * G)) : null;

  for (let i = 0; i < ds.n; i++) {
    const gx = Math.floor(((xy[2 * i] + 1) / 2) * G);
    const gy = Math.floor(((1 - xy[2 * i + 1]) / 2) * G);
    if (gx < 0 || gy < 0 || gx >= G || gy >= G) continue;
    const o = gy * G + gx;
    total[o] += 1;
    if (byCluster && ds.cluster[i] >= 0) clusters[ds.cluster[i]][o] += 1;
    if (byImage) for (let c = 0; c < 3; c++) rgb[c][o] += ds.color[i * 3 + c];
  }

  gaussian(total, sigma);
  let dom = null;
  if (byCluster) {
    clusters.forEach((grid) => gaussian(grid, sigma));
    dom = new Int16Array(G * G).fill(-1);
    for (let o = 0; o < G * G; o++) {
      let best = 0;
      for (let c = 0; c < K; c++) if (clusters[c][o] > best) { best = clusters[c][o]; dom[o] = c; }
    }
  }
  if (byImage) {
    rgb.forEach((grid) => gaussian(grid, sigma));
    for (let o = 0; o < G * G; o++) {
      const t = total[o] || 1;
      for (let c = 0; c < 3; c++) rgb[c][o] /= t;
    }
  }

  // normalise against a high percentile so a single spike doesn't wash everything out
  const sample = [];
  for (let o = 0; o < G * G; o += 7) if (total[o] > 0) sample.push(total[o]);
  sample.sort((a, b) => a - b);
  const norm = sample[Math.floor(sample.length * 0.995)] || 1;

  const field = { total, dom, rgb, norm };
  densityCache = { key, field };
  return field;
}

function renderDensity(ds, xy, p, view, palette) {
  const f = densityField(ds, xy, p);
  const g = sheetGeometry(p);
  const k = view.dpi / 25.4;
  const out = new ImageData(view.w, view.h);
  const d = out.data;
  const pal = palette.map(hexToRgb);
  const bands = p.bands | 0;

  for (let y = 0; y < view.h; y++) {
    const ly = (g.cy - (y + view.y0 + 0.5) / k) / g.half;
    const fy = ((1 - ly) / 2) * G - 0.5;
    for (let x = 0; x < view.w; x++) {
      const o4 = (y * view.w + x) * 4;
      d[o4 + 3] = 255;
      const lx = ((x + view.x0 + 0.5) / k - g.cx) / g.half;
      const fx = ((lx + 1) / 2) * G - 0.5;
      let t = 0, cell = -1;
      if (fx >= 0 && fy >= 0 && fx < G - 1 && fy < G - 1) {
        const ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, o = iy * G + ix;
        const v = (f.total[o] * (1 - ax) + f.total[o + 1] * ax) * (1 - ay)
          + (f.total[o + G] * (1 - ax) + f.total[o + G + 1] * ax) * ay;
        t = Math.min(1, v / f.norm) ** p.gamma;
        cell = Math.round(fy) * G + Math.round(fx);
      }
      if (bands > 0) t = Math.min(1, Math.floor(t * (bands + 1)) / bands);
      let r = 0, gg = 0, b = 0;
      if (f.dom && cell >= 0 && f.dom[cell] >= 0) {
        [r, gg, b] = pal[f.dom[cell] % pal.length];
      } else if (f.rgb && cell >= 0) {
        r = f.rgb[0][cell]; gg = f.rgb[1][cell]; b = f.rgb[2][cell];
      }
      d[o4] = 255 + (r - 255) * t;
      d[o4 + 1] = 255 + (gg - 255) * t;
      d[o4 + 2] = 255 + (b - 255) * t;
    }
  }
  return out;
}

export function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
