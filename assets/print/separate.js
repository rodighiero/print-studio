// Turns the RGB design into ink layers (one per screen).
// A layer is { name, ink: [r,g,b], data: Uint8Array } where data is ink amount 0..255.
// With simulate=true layers keep continuous coverage (for the small preview);
// otherwise they are screened to pure 0/255 masks, ready to become films.

import { hexToRgb } from './render.js';

const CMYK_ANGLES = { C: 15, M: 75, Y: 0, K: 45 };
const CMYK_INKS = { C: '#00a0e9', M: '#e4007f', Y: '#fff100', K: '#1a1a1a' };

export function separate(img, p, view, simulate) {
  const { data, width: w, height: h } = img;
  const n = w * h;

  if (p.inkMode === 'spot') {
    const inks = p.inks.map(hexToRgb);
    const masks = inks.map(() => new Uint8Array(n));
    if (p.spotMethod === 'dither') ditherToPalette(data, w, h, inks, masks);
    else nearestToPalette(data, n, inks, masks);
    return masks.map((m, i) => ({ name: `ink${i + 1}-${p.inks[i].slice(1)}`, ink: inks[i], data: m }));
  }

  if (p.inkMode === 'cmyk') {
    const ch = { C: new Uint8Array(n), M: new Uint8Array(n), Y: new Uint8Array(n), K: new Uint8Array(n) };
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const c = 1 - data[o] / 255, m = 1 - data[o + 1] / 255, y = 1 - data[o + 2] / 255;
      const k = Math.min(c, m, y) * p.gcr;
      const d = 1 - k || 1;
      ch.C[i] = 255 * (c - k) / d;
      ch.M[i] = 255 * (m - k) / d;
      ch.Y[i] = 255 * (y - k) / d;
      ch.K[i] = 255 * k;
    }
    return Object.keys(ch).map((key) => ({
      name: key,
      ink: hexToRgb(CMYK_INKS[key]),
      data: simulate ? ch[key] : screen(ch[key], CMYK_ANGLES[key], p, view),
    }));
  }

  // mono
  const cov = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    cov[i] = 255 - (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
  }
  return [{
    name: 'ink',
    ink: hexToRgb(p.inks[0]),
    data: simulate ? cov : screen(cov, p.angle, p, view),
  }];
}

/* ---------- screening (coverage -> 0/255) ---------- */

function screen(cov, angleDeg, p, view) {
  const { w, h } = view;
  const out = new Uint8Array(w * h);

  if (p.screen === 'threshold') {
    for (let i = 0; i < out.length; i++) out[i] = cov[i] > 127 ? 255 : 0;
    return out;
  }

  if (p.screen === 'fs') {
    // Floyd–Steinberg with two row buffers (full-sheet float buffers would be huge)
    let cur = new Float32Array(w + 2), next = new Float32Array(w + 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = cov[i] + cur[x + 1];
        const q = v > 127 ? 255 : 0;
        out[i] = q;
        const e = v - q;
        cur[x + 2] += e * 7 / 16;
        next[x] += e * 3 / 16;
        next[x + 1] += e * 5 / 16;
        next[x + 2] += e * 1 / 16;
      }
      [cur, next] = [next, cur];
      next.fill(0);
    }
    return out;
  }

  // AM screens, computed in absolute sheet pixels so crops match the full render
  const period = view.dpi / p.lpi;
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a) / period, sa = Math.sin(a) / period;
  const TAU = Math.PI * 2;
  const lines = p.screen === 'lines';
  for (let y = 0; y < h; y++) {
    const Y = y + view.y0 + 0.5;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = cov[i] / 255;
      if (c <= 0) continue;
      const X = x + view.x0 + 0.5;
      const u = X * ca + Y * sa;
      let s;
      if (lines) {
        s = Math.cos(TAU * u);
      } else {
        const v = -X * sa + Y * ca;
        s = (Math.cos(TAU * u) + Math.cos(TAU * v)) / 2; // round dot -> checker -> inverted dot
      }
      if (s > 1 - 2 * c) out[i] = 255;
    }
  }
  return out;
}

/* ---------- spot colour assignment ---------- */

function dist(r, g, b, c) {
  const dr = r - c[0], dg = g - c[1], db = b - c[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

function nearest(r, g, b, inks) {
  let best = -1, bd = dist(r, g, b, [255, 255, 255]); // -1 = paper
  for (let j = 0; j < inks.length; j++) {
    const d = dist(r, g, b, inks[j]);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

function nearestToPalette(data, n, inks, masks) {
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    const j = nearest(data[o], data[o + 1], data[o + 2], inks);
    if (j >= 0) masks[j][i] = 255;
  }
}

function ditherToPalette(data, w, h, inks, masks) {
  const pal = [[255, 255, 255], ...inks];
  let cur = new Float32Array((w + 2) * 3), next = new Float32Array((w + 2) * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4, e0 = (x + 1) * 3;
      const r = data[o] + cur[e0], g = data[o + 1] + cur[e0 + 1], b = data[o + 2] + cur[e0 + 2];
      const j = nearest(r, g, b, inks);
      if (j >= 0) masks[j][i] = 255;
      const q = pal[j + 1];
      const er = [r - q[0], g - q[1], b - q[2]];
      for (let c = 0; c < 3; c++) {
        cur[e0 + 3 + c] += er[c] * 7 / 16;
        next[e0 - 3 + c] += er[c] * 3 / 16;
        next[e0 + c] += er[c] * 5 / 16;
        next[e0 + 3 + c] += er[c] * 1 / 16;
      }
    }
    [cur, next] = [next, cur];
    next.fill(0);
  }
}

/* ---------- registration marks (added to every layer) ---------- */

export function addMarks(layers, p, view) {
  const [W, H] = p.sheet;
  const m = p.margin;
  if (m < 8) return; // no room in the margin
  const k = view.dpi / 25.4;
  const R = Math.min(5, m / 2 - 1);
  const size = Math.ceil(2 * R * k) + 2;
  const c = new OffscreenCanvas(size, size);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, 0.25 * k);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, R * 0.6 * k, 0, Math.PI * 2);
  ctx.moveTo(1, size / 2); ctx.lineTo(size - 1, size / 2);
  ctx.moveTo(size / 2, 1); ctx.lineTo(size / 2, size - 1);
  ctx.stroke();
  const alpha = ctx.getImageData(0, 0, size, size).data;

  const centres = [[W / 2, m / 2], [W / 2, H - m / 2], [m / 2, H / 2], [W - m / 2, H / 2]];
  for (const [cx, cy] of centres) {
    const ox = Math.round(cx * k - view.x0 - size / 2);
    const oy = Math.round(cy * k - view.y0 - size / 2);
    for (let y = 0; y < size; y++) {
      const vy = oy + y;
      if (vy < 0 || vy >= view.h) continue;
      for (let x = 0; x < size; x++) {
        const vx = ox + x;
        if (vx < 0 || vx >= view.w) continue;
        const a = alpha[(y * size + x) * 4 + 3];
        if (!a) continue;
        const i = vy * view.w + vx;
        for (const L of layers) L.data[i] = Math.max(L.data[i], a > 127 ? 255 : a);
      }
    }
  }
}

/* ---------- previews ---------- */

// Simulated print: inks multiplied over the paper colour
export function composite(layers, paperHex, w, h) {
  const out = new ImageData(w, h);
  const d = out.data;
  const paper = hexToRgb(paperHex);
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    let r = paper[0], g = paper[1], b = paper[2];
    for (const L of layers) {
      const a = L.data[i];
      if (!a) continue;
      const t = a / 255;
      r *= 1 - t * (1 - L.ink[0] / 255);
      g *= 1 - t * (1 - L.ink[1] / 255);
      b *= 1 - t * (1 - L.ink[2] / 255);
    }
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  return out;
}

// Film positive: ink = black, no ink = white
export function film(layer, w, h) {
  const out = new ImageData(w, h);
  const d = out.data;
  for (let i = 0, o = 0; i < w * h; i++, o += 4) {
    const v = 255 - layer.data[i];
    d[o] = v; d[o + 1] = v; d[o + 2] = v; d[o + 3] = 255;
  }
  return out;
}
