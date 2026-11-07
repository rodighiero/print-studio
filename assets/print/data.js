// Loads the PixPlot output in data/ into flat typed arrays for the print studio.
// Cell order (atlas by atlas) is the same order used by the layout.

export async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // .json.gz files may arrive raw (python http.server) or already decoded by the server
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// manifest paths are prefixed with the pipeline's output directory
const local = (path) => path.replace(/\\/g, '/').replace(/^output\//, '');

function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

export async function loadDataset(status = () => {}) {
  status('Loading manifest…');
  const manifest = await fetchJson('data/manifest.json');
  const imagelist = await fetchJson(local(manifest.imagelist));

  const cellPx = manifest.config.sizes.cell; // atlas cells are cellPx tall, width follows aspect
  const sizes = imagelist.cell_sizes;
  const positions = imagelist.atlas.positions;
  const n = sizes.reduce((sum, a) => sum + a.length, 0);

  const atlasIdx = new Uint8Array(n);
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sw = new Float32Array(n);
  let totalCellArea = 0;
  for (let a = 0, k = 0; a < sizes.length; a++) {
    for (let j = 0; j < sizes[a].length; j++, k++) {
      const [w, h] = sizes[a][j];
      atlasIdx[k] = a;
      sx[k] = positions[a][j][0];
      sy[k] = positions[a][j][1];
      totalCellArea += w * h;
      sw[k] = (w / h) * cellPx;
    }
  }

  status('Loading atlases…');
  const atlasDir = local(manifest.atlas_dir);
  const atlases = await Promise.all(
    sizes.map((_, i) => loadImage(`${atlasDir}/atlas-${i}.jpg`))
  );

  status('Measuring image colors…');
  const color = new Uint8ClampedArray(n * 3);
  const lum = new Float32Array(n); // 0 = black, 1 = white
  const css = new Array(n);
  for (let a = 0; a < atlases.length; a++) {
    const img = atlases[a];
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    for (let k = 0; k < n; k++) {
      if (atlasIdx[k] !== a) continue;
      const x0 = Math.floor(sx[k]), x1 = Math.max(x0 + 1, Math.floor(sx[k] + sw[k]));
      const y0 = Math.floor(sy[k]), y1 = y0 + cellPx;
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let y = y0; y < y1 && y < img.height; y++) {
        for (let x = x0; x < x1 && x < img.width; x++) {
          const o = (y * img.width + x) * 4;
          r += px[o]; g += px[o + 1]; b += px[o + 2]; cnt++;
        }
      }
      cnt = cnt || 1;
      r /= cnt; g /= cnt; b /= cnt;
      color[k * 3] = r; color[k * 3 + 1] = g; color[k * 3 + 2] = b;
      lum[k] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      css[k] = `rgb(${r | 0},${g | 0},${b | 0})`;
    }
  }

  const umap = manifest.layouts.umap.variants[0];
  const layoutPaths = {
    umap: umap.layout,
  };
  const layoutCache = new Map();
  async function layout(name) {
    if (!layoutCache.has(name)) {
      const pts = await fetchJson(local(layoutPaths[name]));
      const xy = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { xy[2 * i] = pts[i][0]; xy[2 * i + 1] = pts[i][1]; }
      layoutCache.set(name, xy);
    }
    return layoutCache.get(name);
  }

  return {
    n,
    meanCellArea: totalCellArea / n,
    pointSizes: manifest.point_sizes,
    color, lum, css, layout,
  };
}
