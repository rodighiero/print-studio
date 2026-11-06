import { loadDataset } from './data.js';
import { renderDesign, fullView, CATEGORICAL } from './render.js';
import { separate, addMarks, composite, film } from './separate.js';
import { imageDataToPng, download } from './export.js';

const PREVIEW_DPI = 60;
const LOUPE_PX = 600;

const form = document.getElementById('controls');
const statusEl = document.getElementById('status');
const preview = document.getElementById('preview');
const viewSelect = document.getElementById('view');
const exportBtn = document.getElementById('export');
const loupe = document.getElementById('loupe');
const loupeCanvas = loupe.querySelector('canvas');
const loupeCaption = loupe.querySelector('figcaption');

let ds = null;
let last = null;        // { p, view, layers } of the current preview
let loupeCentre = null; // [xMm, yMm]
let busy = false;

const status = (msg) => { statusEl.textContent = msg; };
const tick = () => new Promise((r) => setTimeout(r, 0));

function readParams() {
  const el = form.elements;
  const num = (n) => parseFloat(el[n].value);
  const inkMode = el.inkMode.value;
  const spots = [1, 2, 3, 4].map((i) => el[`spot${i}`].value).slice(0, Math.max(1, Math.min(4, num('inkCount') | 0)));
  const inks = inkMode === 'spot' ? spots : [el.monoInk.value];
  return {
    sheet: el.sheet.value.split('x').map(Number),
    margin: num('margin'),
    zoom: num('zoom'),
    offsetX: num('offsetX') || 0,
    offsetY: num('offsetY') || 0,
    caption: el.caption.value.trim(),
    captionSize: num('captionSize'),
    marks: el.marks.checked,
    layout: el.layout.value,
    render: el.render.value,
    size: num('size'),
    colorBy: el.colorBy.value,
    sizeBy: el.sizeBy.value,
    blur: num('blur'),
    gamma: num('gamma'),
    bands: num('bands') | 0,
    inkMode,
    inks,
    paper: el.paper.value,
    spotMethod: el.spotMethod.value,
    screen: el.screen.value,
    lpi: num('lpi'),
    angle: num('angle'),
    gcr: num('gcr'),
    dpi: num('dpi'),
    // cluster colours follow the inks when printing spot colours
    palette: inkMode === 'spot' ? spots : CATEGORICAL,
  };
}

// data-show="inkMode=mono,cmyk;screen=am,lines" -> visible when every clause matches
function updateVisibility() {
  form.querySelectorAll('[data-show]').forEach((node) => {
    const ok = node.dataset.show.split(';').every((clause) => {
      const [name, values] = clause.split('=');
      return values.split(',').includes(form.elements[name].value);
    });
    node.hidden = !ok;
  });
  const count = parseInt(form.elements.inkCount.value, 10) || 1;
  [1, 2, 3, 4].forEach((i) => { form.elements[`spot${i}`].hidden = i > count; });
}

function pipeline(xy, p, view, simulate) {
  const img = renderDesign(ds, xy, p, view, p.palette);
  const layers = separate(img, p, view, simulate);
  if (p.marks) addMarks(layers, p, view);
  return layers;
}

function populateViews(layers) {
  const current = viewSelect.value;
  const options = ['composite', ...layers.map((L) => L.name)];
  viewSelect.innerHTML = options
    .map((o) => `<option value="${o}">${o === 'composite' ? 'Composite' : `Film: ${o}`}</option>`)
    .join('');
  viewSelect.value = options.includes(current) ? current : 'composite';
}

function viewImage(layers, p, w, h) {
  const which = viewSelect.value;
  const layer = layers.find((L) => L.name === which);
  return layer ? film(layer, w, h) : composite(layers, p.paper, w, h);
}

function drawPreview() {
  if (!last) return;
  const { p, view, layers } = last;
  preview.width = view.w;
  preview.height = view.h;
  const ctx = preview.getContext('2d');
  ctx.putImageData(viewImage(layers, p, view.w, view.h), 0, 0);
  if (loupeCentre) {
    const k = view.dpi / 25.4;
    const side = (LOUPE_PX / p.dpi) * 25.4 * k;
    ctx.strokeStyle = '#e4572e';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(loupeCentre[0] * k - side / 2, loupeCentre[1] * k - side / 2, side, side);
  }
}

async function update() {
  if (!ds) return;
  updateVisibility();
  const p = readParams();
  const t0 = performance.now();
  status('Rendering preview…');
  await tick();
  const xy = await ds.layout(p.layout);
  const view = fullView(p, PREVIEW_DPI);
  const layers = pipeline(xy, p, view, true);
  last = { p, view, layers };
  populateViews(layers);
  drawPreview();
  if (loupeCentre) renderLoupe();
  const exportPx = fullView(p, p.dpi);
  status(`${ds.n.toLocaleString()} images · ${layers.length} screen${layers.length > 1 ? 's' : ''} · `
    + `export ${exportPx.w} × ${exportPx.h} px · preview ${Math.round(performance.now() - t0)} ms`);
}

async function renderLoupe() {
  const p = readParams();
  const xy = await ds.layout(p.layout);
  const k = p.dpi / 25.4;
  const view = {
    dpi: p.dpi,
    x0: Math.round(loupeCentre[0] * k - LOUPE_PX / 2),
    y0: Math.round(loupeCentre[1] * k - LOUPE_PX / 2),
    w: LOUPE_PX,
    h: LOUPE_PX,
  };
  const layers = pipeline(xy, p, view, false);
  loupeCanvas.getContext('2d').putImageData(viewImage(layers, p, view.w, view.h), 0, 0);
  const mm = (LOUPE_PX / k).toFixed(0);
  loupeCaption.textContent = `${mm} × ${mm} mm at ${p.dpi} dpi · click outside the sheet to close`;
  loupe.hidden = false;
}

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(update, 200);
}

form.addEventListener('input', (e) => {
  if (e.target === viewSelect) return;
  updateVisibility();
  schedule();
});
viewSelect.addEventListener('change', () => {
  drawPreview();
  if (loupeCentre) renderLoupe();
});

preview.addEventListener('click', (e) => {
  if (!last) return;
  const rect = preview.getBoundingClientRect();
  const xMm = ((e.clientX - rect.left) / rect.width) * last.p.sheet[0];
  const yMm = ((e.clientY - rect.top) / rect.height) * last.p.sheet[1];
  loupeCentre = [xMm, yMm];
  drawPreview();
  renderLoupe();
});
document.getElementById('sheet').addEventListener('click', (e) => {
  if (e.target === preview) return;
  loupeCentre = null;
  loupe.hidden = true;
  drawPreview();
});

exportBtn.addEventListener('click', async () => {
  if (!ds || busy) return;
  busy = true;
  exportBtn.disabled = true;
  try {
    const p = readParams();
    const xy = await ds.layout(p.layout);
    const view = fullView(p, p.dpi);
    status(`Rendering ${view.w} × ${view.h} px…`);
    await tick();
    const layers = pipeline(xy, p, view, false);
    const base = `surprise-machines_${p.render}_${p.inkMode}_${p.dpi}dpi`;
    for (const [i, L] of layers.entries()) {
      status(`Encoding film ${i + 1}/${layers.length} (${L.name})…`);
      await tick();
      download(await imageDataToPng(film(L, view.w, view.h), p.dpi), `${base}_${i + 1}-${L.name}.png`);
    }
    status('Encoding composite proof…');
    await tick();
    download(await imageDataToPng(composite(layers, p.paper, view.w, view.h), p.dpi), `${base}_proof.png`);
    status(`Exported ${layers.length} film${layers.length > 1 ? 's' : ''} + proof at ${p.dpi} dpi.`);
  } catch (err) {
    console.error(err);
    status(`Export failed: ${err.message}`);
  } finally {
    busy = false;
    exportBtn.disabled = false;
  }
});

updateVisibility();
loadDataset(status)
  .then((data) => { ds = data; return update(); })
  .catch((err) => {
    console.error(err);
    status(`Could not load data/: ${err.message}. Serve the repo root over HTTP (python3 -m http.server).`);
  });
