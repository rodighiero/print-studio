// Cluster original artwork colors, weighting every artwork equally (like its dot).
// A small RGB histogram keeps palette generation independent of atlas resolution.
export function extractPalette(colors, count) {
  if (!colors.length || colors.length % 3 || !Number.isInteger(count) || count < 1) {
    throw new Error('Palette generation needs RGB colors and a positive ink count.');
  }
  const histogram = new Map();
  for (let i = 0; i < colors.length; i += 3) {
    const r = colors[i], g = colors[i + 1], b = colors[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = histogram.get(key) ?? { key, rgb: [0, 0, 0], weight: 0 };
    bin.rgb[0] += r; bin.rgb[1] += g; bin.rgb[2] += b;
    bin.weight++;
    histogram.set(key, bin);
  }
  const points = [...histogram.values()].sort((a, b) => a.key - b.key);
  points.forEach(point => { point.rgb = point.rgb.map(value => value / point.weight); });
  const distance = (a, b) => 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;
  const dominant = points.reduce((best, point) => point.weight > best.weight ? point : best);
  let centres = [dominant.rgb.slice()];
  while (centres.length < Math.min(count, points.length)) {
    let candidate, best = -1;
    for (const point of points) {
      const score = point.weight * Math.min(...centres.map(centre => distance(point.rgb, centre)));
      if (score > best) { best = score; candidate = point.rgb; }
    }
    centres.push(candidate.slice());
  }
  for (let iteration = 0; iteration < 24; iteration++) {
    const sums = centres.map(() => ({ rgb: [0, 0, 0], weight: 0 }));
    for (const point of points) {
      let nearest = 0;
      for (let i = 1; i < centres.length; i++) {
        if (distance(point.rgb, centres[i]) < distance(point.rgb, centres[nearest])) nearest = i;
      }
      const sum = sums[nearest];
      sum.weight += point.weight;
      point.rgb.forEach((value, channel) => { sum.rgb[channel] += value * point.weight; });
    }
    const next = sums.map((sum, i) => sum.weight ? sum.rgb.map(value => value / sum.weight) : centres[i]);
    const shift = Math.max(...centres.map((centre, i) => distance(centre, next[i])));
    centres = next;
    if (shift < 0.01) break;
  }
  const brightness = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  centres.sort((a, b) => brightness(a) - brightness(b));
  const palette = centres.map(rgb => '#' + rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join(''));
  while (palette.length < count) palette.push(palette.at(-1));
  return palette;
}
