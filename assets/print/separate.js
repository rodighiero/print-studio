// Turns the RGBA design into ink layers (one per screen).
// A layer is { name, ink: [r,g,b], data: Uint8Array } where data is ink amount 0..255.
// With simulate=true layers keep continuous coverage (for the small preview);
// otherwise every layer is a pure 0/255 film mask. All screens and dithers are
// computed in absolute sheet pixels, so any crop (the loupe) matches the export.

import { hexToRgb } from './render.js';

const CMYK_ANGLES = { C: 15, M: 75, Y: 0, K: 45 };
const CMYK_INKS = { C: '#00a0e9', M: '#e4007f', Y: '#fff100', K: '#1a1a1a' };

export function separate(img, p, view, simulate) {
  const { data, width: w, height: h } = img;
  const n = w * h;

  if (p.inkMode === 'spot') {
    const inks = p.inks.map(hexToRgb);
    const paper = hexToRgb(p.paper || '#ffffff');
    const masks = inks.map(() => new Uint8Array(n));
    if (p.spotMethod === 'dither') ditherToPalette(data, view, inks, paper, masks);
    else nearestToPalette(data, view, inks, paper, masks, simulate);
    // Name by position only, so editing an ink color keeps the selected preview film.
    return masks.map((m, i) => ({ name: `ink${i + 1}`, file: `ink${i + 1}-${p.inks[i].slice(1)}`, ink: inks[i], data: m }));
  }

  if (p.inkMode === 'cmyk') {
    const ch = { C: new Uint8Array(n), M: new Uint8Array(n), Y: new Uint8Array(n), K: new Uint8Array(n) };
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const alpha = data[o + 3] / 255;
      const c = 1 - data[o] / 255, m = 1 - data[o + 1] / 255, y = 1 - data[o + 2] / 255;
      const k = Math.min(c, m, y) * p.gcr;
      const d = 1 - k || 1;
      ch.C[i] = 255 * (c - k) / d * alpha;
      ch.M[i] = 255 * (m - k) / d * alpha;
      ch.Y[i] = 255 * (y - k) / d * alpha;
      ch.K[i] = 255 * k * alpha;
    }
    return Object.keys(ch).map((key, c) => ({
      name: key,
      ink: hexToRgb(CMYK_INKS[key]),
      data: simulate ? ch[key] : screen(ch[key], CMYK_ANGLES[key], p, view, c),
    }));
  }

  // mono
  const cov = new Uint8Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    cov[i] = (255 - (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2])) * data[o + 3] / 255;
  }
  return [{
    name: 'ink',
    ink: hexToRgb(p.inks[0]),
    data: simulate ? cov : screen(cov, p.angle, p, view),
  }];
}

/* ---------- screening (coverage -> 0/255) ---------- */

function screen(cov, angleDeg, p, view, channel = 0) {
  const { w, h } = view;
  const out = new Uint8Array(w * h);

  if (p.screen === 'threshold') {
    for (let i = 0; i < out.length; i++) out[i] = cov[i] > 127 ? 255 : 0;
    return out;
  }

  if (p.screen === 'fs') {
    // Stochastic (FM) screen: a dispersed noise threshold in absolute sheet
    // pixels. Unlike error diffusion it does not depend on where a crop starts.
    // Each process channel uses a shifted pattern so inks do not stack.
    const sx = channel * 37, sy = channel * 71;
    for (let y = 0; y < h; y++) {
      const Y = y + view.y0 + sy;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cov[i] > threshold(x + view.x0 + sx, Y)) out[i] = 255;
      }
    }
    return out;
  }

  // AM screens, computed in absolute sheet pixels so crops match the full render
  if (!(p.lpi > 0) || !Number.isFinite(angleDeg)) throw new Error(`Invalid screen: ${p.lpi} lpi at ${angleDeg}°`);
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

// Interleaved gradient noise: a well-dispersed threshold in 0.5..254.5 for
// integer sheet pixel (X, Y), so coverage 0 never inks and 255 always does.
export function threshold(X, Y) {
  const t = 52.9829189 * ((0.06711056 * X + 0.00583715 * Y) % 1);
  return 0.5 + 254 * (t - Math.floor(t));
}

/* ---------- spot color assignment ---------- */

function dist(r, g, b, c) {
  const dr = r - c[0], dg = g - c[1], db = b - c[2];
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

// Index of the closest ink, or -1 when the paper itself is closest.
function nearest(r, g, b, inks, paper) {
  let best = -1, bd = dist(r, g, b, paper);
  for (let j = 0; j < inks.length; j++) {
    const d = dist(r, g, b, inks[j]);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

// Mark color picks the ink; mark coverage (alpha) becomes ink amount. Films
// threshold that coverage against the noise screen, so antialiased edges and
// subpixel thumbnails keep their average density as pure black/white pixels.
function nearestToPalette(data, view, inks, paper, masks, simulate) {
  const { w, h } = view;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4, a = data[o + 3];
      if (!a) continue;
      const j = nearest(data[o], data[o + 1], data[o + 2], inks, paper);
      if (j < 0) continue;
      if (simulate) masks[j][i] = a;
      else if (a > threshold(x + view.x0, y + view.y0)) masks[j][i] = 255;
    }
  }
}

// Ordered dither to the ink palette: the color over paper is offset by the
// sheet-anchored noise before choosing the nearest ink, so crops match.
const DITHER_SPREAD = 96;
function ditherToPalette(data, view, inks, paper, masks) {
  const { w, h } = view;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 4;
      const alpha = data[o + 3] / 255;
      if (!alpha) continue;
      const d = (threshold(x + view.x0, y + view.y0) / 255 - 0.5) * DITHER_SPREAD;
      const r = paper[0] + (data[o] - paper[0]) * alpha + d;
      const g = paper[1] + (data[o + 1] - paper[1]) * alpha + d;
      const b = paper[2] + (data[o + 2] - paper[2]) * alpha + d;
      const j = nearest(r, g, b, inks, paper);
      if (j >= 0) masks[j][i] = 255;
    }
  }
}

/* ---------- registration marks (export films only) ---------- */

// Draws crosshair targets centered in the bleed on each side of the sheet and
// crop marks at the corners, identically on every film. `view.trim` is the
// sheet size in pixels; the sheet starts at (-view.x0, -view.y0).
export function addMarks(layers, view) {
  const bx = -view.x0, by = -view.y0;
  const bleed = Math.min(bx, by);
  if (bleed < 8) return;
  const k = view.dpi / 25.4;
  const lw = Math.max(1, 0.25 * k) / 2;
  const R = bleed * 0.25, arm = bleed * 0.4;
  const { w: tw, h: th } = view.trim;
  const ink = (x, y) => {
    if (x < 0 || y < 0 || x >= view.w || y >= view.h) return;
    const i = y * view.w + x;
    for (const L of layers) L.data[i] = 255;
  };
  const target = (cx, cy) => {
    for (let y = Math.floor(cy - arm); y <= Math.ceil(cy + arm); y++) {
      for (let x = Math.floor(cx - arm); x <= Math.ceil(cx + arm); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const onCross = (Math.abs(dx) <= lw && Math.abs(dy) <= arm) || (Math.abs(dy) <= lw && Math.abs(dx) <= arm);
        if (onCross || Math.abs(Math.hypot(dx, dy) - R) <= lw) ink(x, y);
      }
    }
  };
  target(bx + tw / 2, by / 2);
  target(bx + tw / 2, by + th + by / 2);
  target(bx / 2, by + th / 2);
  target(bx + tw + bx / 2, by + th / 2);

  // Crop marks: trim lines extended into the bleed, starting 2 mm off the sheet.
  const gap = Math.round(2 * k), t = Math.max(1, Math.round(2 * lw)), h0 = Math.floor(t / 2);
  for (const [ex, dx] of [[bx, -1], [bx + tw, 1]]) {
    for (const [ey, dy] of [[by, -1], [by + th, 1]]) {
      for (let d = gap; d < bleed - 1; d++) {
        for (let s = -h0; s < t - h0; s++) {
          ink(ex + dx * d - (dx < 0 ? 1 : 0), ey + s); // horizontal, on the trim line
          ink(ex + s, ey + dy * d - (dy < 0 ? 1 : 0)); // vertical, on the trim line
        }
      }
    }
  }
}

/* ---------- previews ---------- */

// Simulated print: inks multiplied over the paper color
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
