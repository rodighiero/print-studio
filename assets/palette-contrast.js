// Oklab conversions from Björn Ottosson's public-domain reference:
// https://bottosson.github.io/posts/oklab/
export function hexToOklab(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function linearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function hueToHex(L, chroma, hue) {
  const atChroma = value => linearRgb([L, value * Math.cos(hue), value * Math.sin(hue)]);
  const inGamut = rgb => rgb.every(value => value >= -1e-7 && value <= 1 + 1e-7);
  let rgb = atChroma(chroma);
  if (!inGamut(rgb)) {
    // Reduce saturation only as much as needed; never clip channels or change L.
    let low = 0, high = chroma;
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (inGamut(atChroma(mid))) low = mid;
      else high = mid;
    }
    rgb = atChroma(low);
  }
  return '#' + rgb.map(value => {
    const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, encoded)) * 255).toString(16).padStart(2, '0');
  }).join('');
}

export function contrastPalette(palette) {
  if (new Set(palette).size < 2) return [...palette];
  const inks = palette.map((hex, index) => {
    const [L, a, b] = hexToOklab(hex);
    return { index, L, chroma: Math.hypot(a, b), hue: Math.atan2(b, a) };
  }).filter(ink => ink.chroma >= 0.003);
  if (inks.length < 2) return [...palette];
  const tau = Math.PI * 2;
  inks.sort((a, b) => a.hue - b.hue || a.index - b.index);
  // Unwrap around the largest empty hue arc so reds on either side of zero stay together.
  let largestGap = -1, start = 0;
  inks.forEach((ink, i) => {
    const gap = (inks[(i + 1) % inks.length].hue - ink.hue + tau) % tau;
    if (gap > largestGap) { largestGap = gap; start = (i + 1) % inks.length; }
  });
  const ordered = [...inks.slice(start), ...inks.slice(0, start)];
  const hues = ordered.map(ink => ink.hue);
  for (let i = 1; i < hues.length; i++) {
    while (hues[i] < hues[i - 1]) hues[i] += tau;
  }
  const gap = (inks.length === 2 ? 90 : 70) * Math.PI / 180;
  for (let iteration = 0; iteration < 32; iteration++) {
    for (let i = 1; i < hues.length; i++) {
      const shift = Math.max(0, gap - (hues[i] - hues[i - 1])) / 2;
      hues[i - 1] -= shift;
      hues[i] += shift;
    }
  }
  const result = [...palette];
  ordered.forEach((ink, i) => {
    result[ink.index] = hueToHex(ink.L, ink.chroma, hues[i]);
  });
  return result;
}
