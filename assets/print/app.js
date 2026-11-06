import projectSettings from '../../studio-settings.json';
import { drawMotionPreview } from './motion-preview.js';
import { loadDataset } from './data.js';
import { renderDesign, fullView, CATEGORICAL } from './render.js';
import { separate, composite, film } from './separate.js';
import { imageDataToPng, download } from './export.js';

const PREVIEW_DPI = 60;
const LOUPE_PX = 600;
const SETTINGS_KEY = 'surprise-machines.print-studio.settings.v1';

const form = document.getElementById('controls');
const statusEl = document.getElementById('status');
const preview = document.getElementById('preview');
const previewSnapshot = document.createElement('canvas');
const viewGroup = document.getElementById('view');
const exportBtn = document.getElementById('export');
const loupe = document.getElementById('loupe');
const loupeCanvas = loupe.querySelector('canvas');
const loupeCaption = loupe.querySelector('figcaption');

let ds = null;
let last = null;        // { p, view, layers } of the current preview
let loupeCentre = null; // [xMm, yMm]
let busy = false;
let tool = 'move';
let drag = null;
let revision = 0;
const previewWorker = new Worker(new URL('./preview-worker.js', import.meta.url), { type: 'module' });
let workerRequest = null;
previewWorker.onmessage = ({ data }) => {
  if (!workerRequest || data.id !== workerRequest.id) return;
  const pending = workerRequest;
  workerRequest = null;
  if (data.error) pending.reject(new Error(data.error));
  else pending.resolve(data.layers);
};
previewWorker.onerror = (event) => {
  if (workerRequest) workerRequest.reject(new Error(event.message));
  workerRequest = null;
};
function renderPreview(p, view, id) {
  return new Promise((resolve, reject) => {
    workerRequest = { id, resolve, reject };
    previewWorker.postMessage({ id, p, view });
  });
}
let selectedView = 'composite';
// Keep calibration independent of the current window or preview size.
let referenceHeight = 900;
let referencePixelRatio = window.devicePixelRatio || 1;
const toolButtons = ['move', 'inspect'].map((id) => document.getElementById(id));
const canvasButtons = document.querySelectorAll('.toolbar button');
canvasButtons.forEach((button) => { button.disabled = true; });
const zoomLevel = document.getElementById('zoom-level');

// Store raw control values so hidden inks and checkbox state survive a refresh.
function settingControls() {
  return Array.from(form.elements).filter((el) => el.name && el.name !== 'previewFilm' && ['INPUT', 'OUTPUT'].includes(el.tagName));
}
function saveSettings() {
  try {
    const values = Object.fromEntries(settingControls().filter((el) => el.type !== 'radio' || el.checked).map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value]));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ values, referenceHeight, referencePixelRatio, view: selectedView, tool, positionVersion: 2, zoomRangeVersion: 1 }));
  } catch {
    // Saving is optional when browser storage is unavailable.
  }
}
function applySettings(saved) {
  try {
    if (!saved || typeof saved.values !== 'object' || !saved.values) return;
    for (const el of settingControls()) {
      const value = saved.values[el.name];
      if (el.type === 'radio') {
        const valid = Array.from(form.elements).some((option) => option.type === 'radio' && option.name === el.name && option.value === value);
        if (valid) el.checked = el.value === value;
        continue;
      }
      if (el.type === 'checkbox') {
        if (typeof value === 'boolean') el.checked = value;
        continue;
      }
      if (typeof value !== 'string') continue;
      if (el.type === 'number' || el.type === 'range' || el.tagName === 'OUTPUT') {
        const n = Number(value);
        if (!value.trim() || !Number.isFinite(n)) continue;
        if ((el.min !== '' && n < Number(el.min)) || (el.max !== '' && n > Number(el.max))) continue;
      }
      if (el.type === 'color' && !/^#[0-9a-f]{6}$/i.test(value)) continue;
      el.value = value;
    }
    // Preserve previous calibration when migrating from the removed control.
    const storedHeight = Number(saved.referenceHeight ?? saved.values.referenceHeight);
    if (Number.isFinite(storedHeight) && storedHeight >= 100 && storedHeight <= 10000) {
      referenceHeight = storedHeight;
    }
    const storedRatio = Number(saved.referencePixelRatio);
    if (Number.isFinite(storedRatio) && storedRatio >= 0.5 && storedRatio <= 8) {
      referencePixelRatio = storedRatio;
    }
    // Re-centre older saved positions on the original app camera target once.
    // Later saves retain manual positioning across refreshes.
    if (saved.positionVersion !== 2) {
      form.elements.offsetX.value = '0';
      form.elements.offsetY.value = '0';
    }
    // Start the revised zoom range at 100% once; retain later user choices.
    if (saved.zoomRangeVersion !== 1) form.elements.zoom.value = '1';
    if (typeof saved.view === 'string') selectedView = saved.view;
    if (saved.tool === 'move' || saved.tool === 'inspect') tool = saved.tool;
    if (saved.positionVersion !== 2 || saved.zoomRangeVersion !== 1) saveSettings();
  } catch {
    // Missing, outdated or unavailable storage must never prevent startup.
  }
}

function restoreSettings() {
  applySettings(projectSettings);
  try {
    applySettings(JSON.parse(localStorage.getItem(SETTINGS_KEY)));
  } catch {
    // Project defaults still work when local storage is unavailable or corrupt.
  }
}

function syncZoom() {
  const zoom = form.elements.zoom;
  zoomLevel.value = `${Math.round(Number(zoom.value) * 100)}%`;
  document.getElementById('zoom-out').disabled = !ds || Number(zoom.value) <= Number(zoom.min);
  document.getElementById('zoom-in').disabled = !ds || Number(zoom.value) >= Number(zoom.max);
}
function setTool(next) {
  tool = next;
  preview.dataset.tool = next;
  toolButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.id === next)));
  document.getElementById('canvas-hint').textContent = next === 'move'
    ? 'Drag to position the map · Scroll to zoom'
    : 'Click the sheet to inspect the screen · Escape to close · M to move';
}
function closeLoupe() {
  loupeCentre = null;
  loupe.hidden = true;
  drawPreview();
}
function zoomMap(factor) {
  if (!ds) return;
  const el = form.elements;
  const before = Number(el.zoom.value);
  const after = Math.max(Number(el.zoom.min), Math.min(Number(el.zoom.max), Math.round(before * factor * 100) / 100));
  el.zoom.value = after;
  syncZoom();
  schedule(true);
}
function sheetPoint(event) {
  const frame = preview.parentElement.getBoundingClientRect();
  const width = preview.clientWidth, height = preview.clientHeight;
  const sheet = readParams().sheet;
  return [(event.clientX - (frame.left + (frame.width - width) / 2)) / width * sheet[0], (event.clientY - (frame.top + (frame.height - height) / 2)) / height * sheet[1]];
}

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
    zoom: num('zoom'),
    offsetX: num('offsetX') || 0,
    offsetY: num('offsetY') || 0,
    layout: 'umap',
    render: 'dots',
    referenceHeight,
    referencePixelRatio,
    colorBy: el.colorBy.value,
    sizeBy: el.sizeBy.value,
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
  return layers;
}

function populateViews(layers) {
  const current = selectedView;
  const options = ['composite', ...layers.map((L) => L.name)];
  selectedView = options.includes(current) ? current : 'composite';
  const existing = Array.from(viewGroup.querySelectorAll('input')).map(input => input.value);
  if (JSON.stringify(existing) === JSON.stringify(options)) return;
  const choices = options.map((value) => {
    const label = document.createElement('label');
    label.className = 'radio-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'previewFilm';
    input.value = value;
    input.checked = value === selectedView;
    const text = document.createElement('span');
    text.textContent = value === 'composite' ? 'Composite' : `Film: ${value}`;
    label.append(input, text);
    return label;
  });
  viewGroup.querySelector('.radio-options').replaceChildren(...choices);
}

function viewImage(layers, p, w, h) {
  const which = selectedView;
  const layer = layers.find((L) => L.name === which);
  return layer ? film(layer, w, h) : composite(layers, p.paper, w, h);
}

function drawPreview() {
  if (!last) return;
  const { p, view, layers } = last;
  preview.width = view.w;
  preview.height = view.h;
  const ctx = preview.getContext('2d');
  const image = viewImage(layers, p, view.w, view.h);
  previewSnapshot.width = view.w;
  previewSnapshot.height = view.h;
  previewSnapshot.getContext('2d').putImageData(image, 0, 0);
  ctx.drawImage(previewSnapshot, 0, 0);
  drawLoupeOutline(p, view);
}

function drawLoupeOutline(p, view) {
  const ctx = preview.getContext('2d');
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
  const request = revision;
  const p = readParams();
  status('Rendering preview…');
  await tick();
  const xy = await ds.layout(p.layout);
  if (request !== revision) return;
  const view = fullView(p, PREVIEW_DPI);
  const layers = await renderPreview(p, view, request);
  if (request !== revision) return;
  last = { p, view, layers };
  populateViews(layers);
  drawPreview();
  if (loupeCentre) await renderLoupe();
  const exportPx = fullView(p, p.dpi);
  status(`${ds.n.toLocaleString()} images · ${layers.length} screen${layers.length > 1 ? 's' : ''} · `
    + `export ${exportPx.w} × ${exportPx.h} px`);
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
let updating = false;
let pendingUpdate = false;
let motionFrame = null;
function motionPreview() {
  if (!last || motionFrame !== null) return;
  motionFrame = requestAnimationFrame(() => {
    motionFrame = null;
    const p = readParams();
    if (p.sheet.join() !== last.p.sheet.join()) return;
    const background = last.layers.some(layer => layer.name === selectedView) ? '#ffffff' : last.p.paper;
    drawMotionPreview(preview.getContext('2d'), previewSnapshot, last.p, p, background);
    drawLoupeOutline(p, last.view);
  });
}
async function flushPreview() {
  if (updating) { pendingUpdate = true; return; }
  updating = true;
  pendingUpdate = false;
  try { await update(); }
  catch (err) { console.error(err); status(`Could not render preview: ${err.message}`); }
  finally {
    updating = false;
    if (pendingUpdate) flushPreview();
  }
}
function schedule(moving = false) {
  revision++;
  if (moving) motionPreview();
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    saveSettings();
    flushPreview();
  }, moving ? 120 : 0);
}
window.addEventListener('pagehide', saveSettings);

form.addEventListener('input', (e) => {
  if (e.target.name === 'previewFilm') return;
  updateVisibility();
  syncZoom();
  schedule(e.target.name === 'zoom');
});
viewGroup.addEventListener('change', (event) => {
  selectedView = event.target.value;
  saveSettings();
  drawPreview();
  if (loupeCentre) renderLoupe();
});

toolButtons.forEach((button) => button.addEventListener('click', () => {
  setTool(button.id);
  saveSettings();
}));
document.getElementById('close-loupe').addEventListener('click', closeLoupe);
document.getElementById('zoom-in').addEventListener('click', () => zoomMap(1.1));
document.getElementById('zoom-out').addEventListener('click', () => zoomMap(1 / 1.1));
form.addEventListener('submit', (event) => event.preventDefault());

preview.addEventListener('pointerdown', (event) => {
  if (!last || event.button !== 0) return;
  preview.focus({ preventScroll: true });
  if (tool === 'inspect') {
    loupeCentre = sheetPoint(event);
    drawPreview();
    renderLoupe();
    return;
  }
  drag = { id: event.pointerId, start: sheetPoint(event), x: Number(form.elements.offsetX.value), y: Number(form.elements.offsetY.value) };
  preview.setPointerCapture(event.pointerId);
  preview.classList.add('dragging');
});
preview.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const point = sheetPoint(event);
  form.elements.offsetX.value = (drag.x + point[0] - drag.start[0]).toFixed(2);
  form.elements.offsetY.value = (drag.y + point[1] - drag.start[1]).toFixed(2);
  schedule(true);
});
function endDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  drag = null;
  preview.classList.remove('dragging');
  schedule();
}
preview.addEventListener('pointerup', endDrag);
preview.addEventListener('pointercancel', endDrag);
preview.addEventListener('lostpointercapture', endDrag);
preview.addEventListener('wheel', (event) => {
  if (!last || event.ctrlKey) return;
  event.preventDefault();
  zoomMap(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002));
}, { passive: false });
preview.addEventListener('keydown', (event) => {
  if (!last) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomMap(1.1); }
  else if (event.key === '-') { event.preventDefault(); zoomMap(1 / 1.1); }
  else if (event.key.toLowerCase() === 'm') { setTool('move'); saveSettings(); }
  else if (event.key.toLowerCase() === 'i') { setTool('inspect'); saveSettings(); }
  else if (event.key === 'Enter' && tool === 'inspect') {
    loupeCentre = readParams().sheet.map((mm) => mm / 2);
    drawPreview();
    renderLoupe();
  }
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLoupe(); });
document.getElementById('sheet').addEventListener('click', (event) => {
  if (event.target !== preview) closeLoupe();
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

restoreSettings();
saveSettings();
updateVisibility();
syncZoom();
setTool(tool);
loadDataset(status)
  .then(async (data) => {
    ds = data;
    const positions = await ds.layout('umap');
    const { n, meanCellArea, pointSizes, css, lum, cluster } = ds;
    previewWorker.postMessage({ type: 'init', dataset: { n, meanCellArea, pointSizes, css, lum, cluster }, positions });
    await update();
    form.querySelectorAll('.panel-settings').forEach((settings) => { settings.disabled = false; });
    canvasButtons.forEach((button) => { button.disabled = false; });
    syncZoom();
    exportBtn.disabled = false;
    document.getElementById('sheet').setAttribute('aria-busy', 'false');
  })
  .catch((err) => {
    console.error(err);
    status(`Could not load data/: ${err.message}. Check the connection and reload the page.`);
  });
