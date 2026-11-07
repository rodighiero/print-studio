import { fullView } from './render.js';

// Use the same integer-pixel crop for the cursor and the export-resolution detail.
export function inspectionView(p, centre, size) {
  const sheet = fullView(p, p.dpi);
  const origin = centre.map((fraction, i) => {
    const length = i === 0 ? sheet.w : sheet.h;
    return Math.max(0, Math.min(length - size, Math.round(fraction * length - size / 2)));
  });
  return { dpi: p.dpi, x0: origin[0], y0: origin[1], w: size, h: size };
}
