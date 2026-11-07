import projectSettings from '../../studio-settings.json';
import { drawMotionPreview } from './motion-preview.js';
import { loadDataset } from './data.js';
import { renderDesign, fullView, filmView, CATEGORICAL } from './render.js';
import { separate, composite, film } from './separate.js';
import { renderFilms, chooseSaver } from './export.js';

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
const areaToggle = document.getElementById('toggle-area');

let ds = null;
let last = null;        // { p, view, layers } of the current preview
let loupeCentre = [0.5, 0.5]; // selected center as fractions of sheet width/height
let areaVisible = true;
let busy = false;
let tool = 'move';
let drag = null;
let revision = 0;
// One worker keeps the preview responsive; a second renders exports so the
// preview and UI stay usable meanwhile. If a worker cannot load or crashes,
// it is marked broken and the same work runs on the main thread instead.
function workerClient() {
  let worker = null, broken = null, pending = null;
  const fail = (error) => {
    broken = error;
    if (pending) pending.reject(error);
    pending = null;
  };
  try { worker = new Worker(new URL('./preview-worker.js', import.meta.url), { type: 'module' }); }
  catch (error) { broken = error; }
  if (worker) {
    worker.onmessage = ({ data }) => {
      if (!pending || data.id !== pending.id) return;
      if (data.progress) { pending.progress?.(data.progress); return; }
      if (data.file) { pending.file?.(data.file); return; }
      const settled = pending;
      pending = null;
      if (data.error) settled.reject(new Error(data.error));
      else settled.resolve(data.preview ?? data.layers ?? data.done);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || 'Render worker failed to load'));
    };
    worker.onmessageerror = () => fail(new Error('Render worker message could not be read'));
  }
  return {
    get ok() { return !broken; },
    init(message) { if (!broken) worker.postMessage(message); },
    // Requests are serialized by the caller (one in flight per worker).
    request(message, handlers = {}) {
      if (broken) return Promise.reject(broken);
      return new Promise((resolve, reject) => {
        pending = { id: message.id, resolve, reject, ...handlers };
        worker.postMessage(message);
      });
    },
  };
}
const previewWorker = workerClient();
const exportWorker = workerClient();
async function renderPreview(xy, p, view, id) {
  try {
    if (previewWorker.ok) return await previewWorker.request({ id, p, view });
  } catch (error) {
    if (previewWorker.ok) throw error; // a render error, not a worker failure
    console.warn('Preview worker unavailable, rendering on the main thread.', error);
  }
  const design = renderDesign(ds, xy, p, view, p.palette);
  return { design, layers: separate(design, p, view, true) };
}
let selectedView = 'composite';
// Keep calibration independent of the current window or preview size.
let referenceHeight = 900;
let referencePixelRatio = window.devicePixelRatio || 1;
const toolButtons = ['move', 'inspect'].map((id) => document.getElementById(id));
const zoomLevel = document.getElementById('zoom-level');

// Store raw control values so hidden inks and checkbox state survive a refresh.
function settingControls() {
  return Array.from(form.elements).filter((el) => el.name && el.name !== 'previewFilm' && ['INPUT', 'OUTPUT', 'SELECT'].includes(el.tagName));
}
function saveSettings() {
  try {
    // Store only what differs from studio-settings.json, so later changes to
    // the committed defaults still reach returning visitors for untouched values.
    const defaults = projectSettings.values ?? {};
    const values = Object.fromEntries(settingControls()
      .filter((el) => el.type !== 'radio' || el.checked)
      .map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value])
      .filter(([name, value]) => String(value) !== String(defaults[name])));
    const calibration = {};
    if (referenceHeight !== projectSettings.referenceHeight) calibration.referenceHeight = referenceHeight;
    if (referencePixelRatio !== projectSettings.referencePixelRatio) calibration.referencePixelRatio = referencePixelRatio;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ values, ...calibration, view: selectedView, tool, areaVisible, positionVersion: 2, zoomRangeVersion: 2 }));
  } catch {
    // Saving is optional when browser storage is unavailable.
  }
}
function applySettings(saved) {
  try {
    if (!saved || typeof saved.values !== 'object' || !saved.values) return;
    for (const el of settingControls()) {
      const stored = saved.values[el.name];
      const value = el.name === 'colorBy' && stored === 'cluster' ? 'image' : stored;
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
    // Re-center older saved positions on the original app camera target once.
    // Later saves retain manual positioning across refreshes.
    if (saved.positionVersion !== 2) {
      form.elements.offsetX.value = '0';
      form.elements.offsetY.value = '0';
    }
    // Move older saves to the current default zoom once; retain later user choices.
    if (saved.zoomRangeVersion !== 2) form.elements.zoom.value = projectSettings.values.zoom;
    if (typeof saved.view === 'string') selectedView = saved.view;
    if (saved.tool === 'move' || saved.tool === 'inspect') tool = saved.tool;
    if (typeof saved.areaVisible === 'boolean') areaVisible = saved.areaVisible;
    if (saved.positionVersion !== 2 || saved.zoomRangeVersion !== 2) saveSettings();
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
function setTool(next, revealArea = true) {
  tool = next;
  preview.dataset.tool = next;
  toolButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.id === next)));
  if (next === 'inspect' && revealArea) setAreaVisible(true);
}
function setAreaVisible(visible) {
  areaVisible = visible;
  areaToggle.textContent = visible ? 'Hide area' : 'Show area';
  areaToggle.setAttribute('aria-pressed', String(visible));
  drawPreview();
}
areaToggle.addEventListener('click', () => {
  setAreaVisible(!areaVisible);
  saveSettings();
});
function zoomMap(factor) {
  if (!ds) return;
  const el = form.elements;
  const before = Number(el.zoom.value);
  // No per-step rounding: small trackpad deltas must accumulate.
  const after = Math.max(Number(el.zoom.min), Math.min(Number(el.zoom.max), before * factor));
  if (after === before) return;
  el.zoom.value = after;
  syncZoom();
  schedule(true);
}
// Offsets are 0 when the sheet is centered on the original camera target.
const resetPositionBtn = document.getElementById('reset-position');
function syncPosition() {
  resetPositionBtn.disabled = Number(form.elements.offsetX.value) === 0 && Number(form.elements.offsetY.value) === 0;
}
resetPositionBtn.addEventListener('click', () => {
  form.elements.offsetX.value = '0';
  form.elements.offsetY.value = '0';
  syncPosition();
  schedule(true);
});
function sheetPoint(event) {
  const frame = preview.parentElement.getBoundingClientRect();
  const width = preview.clientWidth, height = preview.clientHeight;
  const sheet = readParams().sheet;
  return [(event.clientX - (frame.left + (frame.width - width) / 2)) / width * sheet[0], (event.clientY - (frame.top + (frame.height - height) / 2)) / height * sheet[1]];
}

const status = (msg) => { statusEl.textContent = msg; };
// Empty or out-of-range typed values would blank (NaN) or flood (0) every screened film.
const clampNum = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
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
    sizeBy: 'constant',
    inkMode,
    inks,
    paper: el.paper.value,
    spotMethod: el.spotMethod.value,
    screen: el.screen.value,
    lpi: clampNum(num('lpi'), 5, 85, 35),
    angle: Number.isFinite(num('angle')) ? num('angle') : 22.5,
    gcr: num('gcr'),
    dpi: num('dpi'),
    // cluster colors follow the inks when printing spot colors
    palette: inkMode === 'spot' ? spots : CATEGORICAL,
  };
}

// data-show="inkMode=mono,cmyk;screen=am,lines" -> visible when every clause matches
function updateVisibility() {
  viewGroup.hidden = !form.elements.printPreview.checked;
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
    text.textContent = value === 'composite' ? 'Composite' : `Film ${value}`;
    label.append(input, text);
    return label;
  });
  viewGroup.querySelector('.options').replaceChildren(...choices);
}

function viewImage(layers, p, w, h) {
  const which = selectedView;
  const layer = layers.find((L) => L.name === which);
  return layer ? film(layer, w, h) : composite(layers, p.paper, w, h);
}

function drawPreview() {
  if (!last) return;
  const { p, view, layers, design } = last;
  const printPreview = form.elements.printPreview.checked;
  preview.width = view.w;
  preview.height = view.h;
  const ctx = preview.getContext('2d');
  const image = printPreview ? viewImage(layers, p, view.w, view.h) : design;
  previewSnapshot.width = view.w;
  previewSnapshot.height = view.h;
  const snapshotCtx = previewSnapshot.getContext('2d');
  snapshotCtx.putImageData(image, 0, 0);
  if (!printPreview) {
    snapshotCtx.globalCompositeOperation = 'destination-over';
    snapshotCtx.fillStyle = p.paper;
    snapshotCtx.fillRect(0, 0, view.w, view.h);
    snapshotCtx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(previewSnapshot, 0, 0);
  const label = !printPreview ? 'Original design'
    : selectedView === 'composite' ? 'Print preview · Smooth proof' : `Print preview · Film ${selectedView}`;
  document.getElementById('sheet-mode').textContent = label;
  document.getElementById('sheet').setAttribute('aria-label', label);
  drawLoupeOutline(p, view);
}

function drawLoupeOutline(p, view) {
  const ctx = preview.getContext('2d');
  if (loupeCentre && areaVisible) {
    const k = view.dpi / 25.4;
    const side = (LOUPE_PX / p.dpi) * 25.4 * k;
    ctx.strokeStyle = '#e4572e';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(loupeCentre[0] * p.sheet[0] * k - side / 2, loupeCentre[1] * p.sheet[1] * k - side / 2, side, side);
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
  const { layers, design } = await renderPreview(xy, p, view, request);
  if (request !== revision) return;
  last = { p, view, layers, design };
  populateViews(layers);
  drawPreview();
  if (loupeCentre) await renderLoupe();
  const exportPx = filmView(p, p.dpi);
  status(`${ds.n.toLocaleString()} images · ${layers.length} screen${layers.length > 1 ? 's' : ''} · `
    + `films ${exportPx.w} × ${exportPx.h} px incl. bleed`);
}

let loupeRevision = 0;
async function renderLoupe() {
  if (!ds) return;
  const request = ++loupeRevision;
  const p = readParams();
  const xy = await ds.layout(p.layout);
  if (request !== loupeRevision) return;
  const k = p.dpi / 25.4;
  const view = {
    dpi: p.dpi,
    x0: Math.round(loupeCentre[0] * p.sheet[0] * k - LOUPE_PX / 2),
    y0: Math.round(loupeCentre[1] * p.sheet[1] * k - LOUPE_PX / 2),
    w: LOUPE_PX,
    h: LOUPE_PX,
  };
  const layers = pipeline(xy, p, view, false);
  loupeCanvas.getContext('2d').putImageData(viewImage(layers, p, view.w, view.h), 0, 0);
  const mm = (LOUPE_PX / k).toFixed(0);
  loupeCaption.textContent = `${mm} × ${mm} mm at ${p.dpi} dpi`;
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
    const background = form.elements.printPreview.checked && last.layers.some(layer => layer.name === selectedView) ? '#ffffff' : last.p.paper;
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
  if (e.target.name === 'printPreview') {
    updateVisibility();
    saveSettings();
    drawPreview();
    return;
  }
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
document.getElementById('zoom-in').addEventListener('click', () => zoomMap(1.1));
document.getElementById('zoom-out').addEventListener('click', () => zoomMap(1 / 1.1));
form.addEventListener('submit', (event) => event.preventDefault());

preview.addEventListener('pointerdown', (event) => {
  if (!last || event.button !== 0) return;
  preview.focus({ preventScroll: true });
  if (tool === 'inspect') {
    const p = readParams();
    const halfSide = LOUPE_PX / 2 * 25.4 / p.dpi;
    loupeCentre = sheetPoint(event).map((mm, i) => Math.max(halfSide, Math.min(p.sheet[i] - halfSide, mm)) / p.sheet[i]);
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
  syncPosition();
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
    loupeCentre = [0.5, 0.5];
    drawPreview();
    renderLoupe();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { setTool('move'); saveSettings(); }
});

// Hide every floating panel to look at the sheet alone (H, or the corner toggle).
const chromeToggle = document.getElementById('chrome-toggle');
function toggleChrome() {
  const hidden = document.body.classList.toggle('chrome-hidden');
  chromeToggle.textContent = hidden ? 'Show panels' : 'Hide panels';
}
chromeToggle.addEventListener('click', toggleChrome);
document.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'h' || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest?.('input:not([type=radio]), textarea, select')) return;
  toggleChrome();
});

let exportId = 0;
exportBtn.addEventListener('click', async () => {
  if (!ds || busy) return;
  let save;
  try {
    save = await chooseSaver(); // first, while the click still counts as user activation
  } catch (err) {
    if (err.name !== 'AbortError') status(`Export failed: ${err.message}`);
    return;
  }
  busy = true;
  exportBtn.disabled = true;
  try {
    const p = readParams();
    const view = filmView(p, p.dpi);
    const writes = [];
    const file = (f) => writes.push(save(f));
    let count;
    if (exportWorker.ok) {
      count = await exportWorker.request({ type: 'export', id: ++exportId, p, view }, { progress: status, file });
    } else {
      const xy = await ds.layout(p.layout);
      count = await renderFilms(ds, xy, p, view, { progress: async (msg) => { status(msg); await tick(); }, file });
    }
    await Promise.all(writes);
    status(`Exported ${count} film${count > 1 ? 's' : ''} + proof at ${p.dpi} dpi (${view.w} × ${view.h} px with registration bleed).`);
  } catch (err) {
    console.error(err);
    status(`Export failed: ${err.message}`);
  } finally {
    busy = false;
    exportBtn.disabled = false;
  }
});

restoreSettings();
syncPosition();
updateVisibility();
syncZoom();
setTool(tool, false);
setAreaVisible(areaVisible);
loadDataset(status)
  .then(async (data) => {
    ds = data;
    const positions = await ds.layout('umap');
    const { n, meanCellArea, pointSizes, css, lum, cluster } = ds;
    const init = { type: 'init', dataset: { n, meanCellArea, pointSizes, css, lum, cluster }, positions };
    previewWorker.init(init);
    exportWorker.init(init);
    await update();
    form.querySelectorAll('.panel-settings').forEach((settings) => { settings.disabled = false; });
    toolButtons.forEach((button) => { button.disabled = false; });
    areaToggle.disabled = false;
    syncPosition();
    syncZoom();
    exportBtn.disabled = false;
    document.getElementById('sheet').setAttribute('aria-busy', 'false');
  })
  .catch((err) => {
    console.error(err);
    status(`Could not load data/: ${err.message}. Check the connection and reload the page.`);
  });
