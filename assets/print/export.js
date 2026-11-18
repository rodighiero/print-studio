// PNG export with a pHYs chunk so print/RIP software reads the intended dpi.

import { renderDesign } from './render.js';
import { separate, addMarks } from './separate.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function physChunk(dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// Exact PNG encoder (canvas encoding can shift some 0/255 pixels by one level,
// which puts gray pixels on films). `pixels` holds one grayscale byte per pixel.
export async function encodePng(pixels, width, height, dpi) {
  const stride = width;
  const raw = new Uint8Array(height * (stride + 1)); // filter byte 0 per row
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const zlib = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 0; // grayscale
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([signature, chunk('IHDR', ihdr), physChunk(dpi), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())], { type: 'image/png' });
}

// Film positive: ink = black (0), no ink = white (255).
export function filmPng(layer, view, dpi) {
  const gray = new Uint8Array(layer.data.length);
  for (let i = 0; i < gray.length; i++) gray[i] = 255 - layer.data[i];
  return encodePng(gray, view.w, view.h, dpi);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Sheet format for file names: A2 or A3, else the size in millimetres.
const SHEET_NAMES = { '420x594': 'A2', '297x420': 'A3' };
const sheetName = ([w, h]) => SHEET_NAMES[`${w}x${h}`] ?? `${w}x${h}mm`;

// One PNG per ink layer; `p.fileTag` marks the dot size when several are exported.
export function filmFileName(p, layer, index) {
  // Spot sets name their ink count; a one-color set needs none.
  const inks = p.inks.length > 1 ? `_${p.inks.length}inks` : '';
  const base = `surprise-machines_${sheetName(p.sheet)}${inks}${p.fileTag ? `_${p.fileTag}` : ''}`;
  // A one-color set is a single film, so it needs no ink suffix.
  return p.inks.length > 1 ? `${base}_ink-${index + 1}-${layer.hex}.png` : `${base}.png`;
}

// Full-resolution films, with registration marks when they have a bleed.
// Runs in the export worker, or on the main thread when workers are unavailable.
// `progress` may return a promise (to let the page repaint); `file` receives each PNG.
export async function renderFilms(dataset, positions, p, view, { progress, file }) {
  await progress(`Rendering ${view.w} × ${view.h} px…`);
  const layers = separate(renderDesign(dataset, positions, p, view), p, view, false);
  if (view.trim) addMarks(layers, view);
  for (const [i, L] of layers.entries()) {
    await progress(`Encoding film ${i + 1}/${layers.length} (${L.name})…`);
    await file({ name: filmFileName(p, L, i), blob: await filmPng(L, view, p.dpi) });
  }
  return layers.length;
}

// Ask for a folder while the click's user activation is still valid, so all
// films are written without the browser's multiple-download prompt.
export async function chooseSaver() {
  if (typeof window.showDirectoryPicker !== 'function') return async (f) => download(f.blob, f.name);
  const dir = await window.showDirectoryPicker({ id: 'print-films', mode: 'readwrite' });
  return async (f) => {
    const out = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
    await out.write(f.blob);
    await out.close();
  };
}
