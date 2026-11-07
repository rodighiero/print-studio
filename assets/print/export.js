// PNG export with a pHYs chunk so print/RIP software reads the intended dpi.

import { renderDesign } from './render.js';
import { separate, addMarks, composite } from './separate.js';

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
// which puts gray pixels on films). `pixels` holds `channels` bytes per pixel:
// 1 = grayscale (films), 3 = RGB (proof).
export async function encodePng(pixels, width, height, channels, dpi) {
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1)); // filter byte 0 per row
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const zlib = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 2;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([signature, chunk('IHDR', ihdr), physChunk(dpi), chunk('IDAT', zlib), chunk('IEND', new Uint8Array())], { type: 'image/png' });
}

// Film positive: ink = black (0), no ink = white (255).
export function filmPng(layer, view, dpi) {
  const gray = new Uint8Array(layer.data.length);
  for (let i = 0; i < gray.length; i++) gray[i] = 255 - layer.data[i];
  return encodePng(gray, view.w, view.h, 1, dpi);
}

export function imageDataToPng(imageData, dpi) {
  const { data, width, height } = imageData;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, o = 0; o < rgb.length; i += 4, o += 3) { rgb[o] = data[i]; rgb[o + 1] = data[i + 1]; rgb[o + 2] = data[i + 2]; }
  return encodePng(rgb, width, height, 3, dpi);
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

// Full-resolution films (with registration marks in the bleed) and a proof.
// Runs in the export worker, or on the main thread when workers are unavailable.
// `progress` may return a promise (to let the page repaint); `file` receives each PNG.
export async function renderFilms(dataset, positions, p, view, { progress, file }) {
  await progress(`Rendering ${view.w} × ${view.h} px…`);
  const layers = separate(renderDesign(dataset, positions, p, view, p.palette), p, view, false);
  addMarks(layers, view);
  const base = `surprise-machines_${p.render}_${p.inkMode}_${p.dpi}dpi`;
  for (const [i, L] of layers.entries()) {
    await progress(`Encoding film ${i + 1}/${layers.length} (${L.name})…`);
    file({ name: `${base}_${i + 1}-${L.file ?? L.name}.png`, blob: await filmPng(L, view, p.dpi) });
  }
  await progress('Encoding composite proof…');
  file({ name: `${base}_proof.png`, blob: await imageDataToPng(composite(layers, p.paper, view.w, view.h), p.dpi) });
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
