import projectSettings from '../../studio-settings.json';
import { drawMotionPreview } from './motion-preview.js';
import { inspectionView } from './inspection.js';
import { extractPalette } from './palette.js';
import { contrastPalette } from './palette-contrast.js';
import { loadDataset } from './data.js';
import { renderDesign, fullView, filmView, CATEGORICAL } from './render.js';
import { separate, composite, film } from './separate.js';
import { renderFilms, chooseSaver } from './export.js';

const PREVIEW_DPI = 60;
const LOUPE_PX = 600;
const SETTINGS_KEY = 'surprise-machines.print-studio.settings.v1';
const settingDefaults = { ...projectSettings.values };
const spotColorOverrides = new Set();
const isSpotColor = name => /^spot[23]Ink[123]$/.test(name);
let palettesReady = false;

const form = document.getElementById('controls');
const statusEl = document.getElementById('status');
const preview = document.getElementById('preview');
const previewSnapshot = document.createElement('canvas');
const viewGroup = document.getElementById('view');
const exportBtn = document.getElementById('export');
const loupe = document.getElementById('loupe');
const loupeCanvas = loupe.querySelector('canvas');
const loupeCaption = loupe.querySelector('figcaption');
const inspectButton = document.getElementById('inspect');
const inspectionArea = document.getElementById('inspection-area');
const inspectHelp = document.getElementById('inspect-help');

let ds = null;
let last = null;        // { p, view, layers } of the current preview
let loupeCentre = [0.5, 0.5]; // selected center as fractions of sheet width/height
let inspectionPointer = false;
let inspectionPanelHover = false;
let inspectionFrame = null;
let selectedCentre = [...loupeCentre];
let busy = false;
let tool = 'move';
let drag = null;
let revision = 0;
// Separate workers render the preview, live inspection and exports so the
// pointer and UI stay responsive meanwhile. If a worker cannot load or crashes,
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
    init(message) {
      if (broken) return;
      try { worker.postMessage(message); } catch (error) { fail(error); }
    },
    // Requests are serialized by the caller (one in flight per worker).
    request(message, handlers = {}) {
      if (broken) return Promise.reject(broken);
      if (pending) return Promise.reject(new Error('Render worker is already busy'));
      return new Promise((resolve, reject) => {
        pending = { id: message.id, resolve, reject, ...handlers };
        try { worker.postMessage(message); } catch (error) { fail(error); }
      });
    },
  };
}
const previewWorker = workerClient();
const exportWorker = workerClient();
const inspectionWorker = workerClient();
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
const zoomLevel = document.getElementById('zoom-level');

// Store raw control values so hidden inks and checkbox state survive a refresh.
function settingControls() {
  return Array.from(form.elements).filter((el) => el.name && el.name !== 'previewFilm' && ['INPUT', 'OUTPUT', 'SELECT'].includes(el.tagName));
}
function saveSettings() {
  if (!palettesReady) return; // Do not overwrite saved palettes while the collection is loading.
  try {
    // Store only what differs from studio-settings.json, so later changes to
    // the committed defaults still reach returning visitors for untouched values.
    const defaults = settingDefaults;
    const values = Object.fromEntries(settingControls()
      .filter((el) => el.type !== 'radio' || el.checked)
      .map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value])
      .filter(([name, value]) => String(value) !== String(defaults[name])));
    const calibration = {};
    if (referenceHeight !== projectSettings.referenceHeight) calibration.referenceHeight = referenceHeight;
    if (referencePixelRatio !== projectSettings.referencePixelRatio) calibration.referencePixelRatio = referencePixelRatio;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ values, ...calibration, view: selectedView, positionVersion: 2, zoomRangeVersion: 2 }));
  } catch {
    // Saving is optional when browser storage is unavailable.
  }
}
function applySettings(saved) {
  try {
    if (!saved || typeof saved.values !== 'object' || !saved.values) return;
    for (const el of settingControls()) {
      const stored = saved.values[el.name];
      let value = el.name === 'colorBy' && stored === 'cluster' ? 'image' : stored;
      // Migrate the former spot mode and ink-count setting to a fixed choice.
      if (el.name === 'inkMode' && value === 'spot') {
        value = Number(saved.values.inkCount ?? 3) <= 2 ? 'spot2' : 'spot3';
      }
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
      if (isSpotColor(el.name)) spotColorOverrides.add(el.name);
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
    if (palettesReady && (saved.positionVersion !== 2 || saved.zoomRangeVersion !== 2)) saveSettings();
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

function initializeSpotPalettes() {
  status('Generating spot palettes from original image colors…');
  for (const count of [2, 3]) {
    const palette = contrastPalette(extractPalette(ds.color, count));
    palette.forEach((color, i) => {
      const name = `spot${count}Ink${i + 1}`;
      settingDefaults[name] = color;
      if (!spotColorOverrides.has(name)) form.elements[name].value = color;
    });
  }
  palettesReady = true;
  saveSettings();
}

function syncZoom() {
  const zoom = form.elements.zoom;
  zoomLevel.value = `${Math.round(Number(zoom.value) * 100)}%`;
  document.getElementById('zoom-out').disabled = !ds || Number(zoom.value) <= Number(zoom.min);
  document.getElementById('zoom-in').disabled = !ds || Number(zoom.value) >= Number(zoom.max);
}
function setTool(next, cancel = false) {
  if (next === 'inspect' && tool !== 'inspect') selectedCentre = [...loupeCentre];
  if (cancel && tool === 'inspect') {
    loupeCentre = [...selectedCentre];
    renderLoupe();
  }
  tool = next;
  preview.dataset.tool = next;
  inspectButton.setAttribute('aria-pressed', String(next === 'inspect'));
  inspectButton.textContent = next === 'inspect' ? 'Cancel inspection' : 'Inspect image';
  inspectHelp.hidden = next !== 'inspect';
  if (next !== 'inspect') inspectionPointer = false;
  drawLoupeOutline();
}
function zoomMap(value) {
  if (!ds) return;
  const el = form.elements;
  const before = Number(el.zoom.value);
  // No per-step rounding: small trackpad deltas must accumulate.
  const after = Math.max(Number(el.zoom.min), Math.min(Number(el.zoom.max), value));
  if (after === before) return;
  el.zoom.value = after;
  syncZoom();
  schedule(true);
}
function stepZoom(step) {
  const next = Math.round((Number(form.elements.zoom.value) + step) * 1e10) / 1e10;
  zoomMap(next);
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
  const rect = preview.getBoundingClientRect();
  const sheet = readParams().sheet;
  return [(event.clientX - rect.left) / rect.width * sheet[0], (event.clientY - rect.top) / rect.height * sheet[1]];
}

const status = (msg) => { statusEl.textContent = msg; };
// Empty or out-of-range typed values would blank (NaN) or flood (0) every screened film.
const clampNum = (v, min, max, fallback) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const tick = () => new Promise((r) => setTimeout(r, 0));

function readParams() {
  const el = form.elements;
  const num = (n) => parseFloat(el[n].value);
  const choice = el.inkMode.value;
  const inkMode = choice === 'spot2' || choice === 'spot3' ? 'spot' : choice;
  const count = choice === 'spot2' ? 2 : 3;
  const spots = Array.from({ length: count }, (_, i) => el[`spot${count}Ink${i + 1}`].value);
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

function viewImage(layers, p, w, h, which = selectedView) {
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
  document.getElementById('sheet').setAttribute('aria-label', label);
  drawLoupeOutline();
}

function drawLoupeOutline() {
  inspectionArea.hidden = !last || (!inspectionPanelHover && (tool !== 'inspect' || !inspectionPointer));
  if (inspectionArea.hidden) return;
  const p = readParams();
  const view = inspectionView(p, loupeCentre, LOUPE_PX);
  const sheet = fullView(p, p.dpi);
  const rect = preview.getBoundingClientRect();
  const frame = preview.parentElement.getBoundingClientRect();
  Object.assign(inspectionArea.style, {
    left: `${rect.left - frame.left + view.x0 / sheet.w * rect.width}px`,
    top: `${rect.top - frame.top + view.y0 / sheet.h * rect.height}px`,
    width: `${view.w / sheet.w * rect.width}px`,
    height: `${view.h / sheet.h * rect.height}px`,
  });
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
let loupeEpoch = 0;
let loupeRendering = false;
let loupePending = false;
async function renderLoupe(moving = false) {
  if (!ds) return;
  ++loupeRevision;
  if (!moving) ++loupeEpoch;
  loupePending = true;
  if (loupeRendering) return;
  loupeRendering = true;
  try {
    // Keep only the newest pointer position while a detail is rendering.
    while (loupePending) {
      loupePending = false;
      const request = loupeRevision;
      const epoch = loupeEpoch;
      const p = readParams();
      const view = inspectionView(p, loupeCentre, LOUPE_PX);
      const printPreview = form.elements.printPreview.checked;
      const which = selectedView;
      let result;
      try {
        if (inspectionWorker.ok) result = await inspectionWorker.request({
          type: 'inspect', id: request, p, view, printPreview,
        });
      } catch (error) {
        if (inspectionWorker.ok) throw error;
        console.warn('Inspection worker unavailable, rendering on the main thread.', error);
      }
      if (epoch !== loupeEpoch) continue;
      if (!result) {
        const xy = await ds.layout(p.layout);
        if (epoch !== loupeEpoch) continue;
        const design = renderDesign(ds, xy, p, view, p.palette);
        result = { design, layers: printPreview ? separate(design, p, view, false) : [] };
      }
      const { design, layers } = result;
      const image = printPreview ? viewImage(layers, p, view.w, view.h, which) : design;
      const ctx = loupeCanvas.getContext('2d');
      ctx.putImageData(image, 0, 0);
      if (!printPreview) {
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = p.paper;
        ctx.fillRect(0, 0, view.w, view.h);
        ctx.globalCompositeOperation = 'source-over';
      }
      const mm = (LOUPE_PX / p.dpi * 25.4).toFixed(0);
      loupeCaption.textContent = `${mm} × ${mm} mm at ${p.dpi} dpi`;
      loupe.hidden = false;
    }
  } catch (error) {
    console.error(error);
    loupeCaption.textContent = `Could not render detail: ${error.message}`;
  } finally {
    loupeRendering = false;
  }
}

function inspectPoint(event) {
  if (!last) return;
  const p = readParams();
  loupeCentre = sheetPoint(event).map((mm, i) => mm / p.sheet[i]);
  inspectionPointer = true;
  drawLoupeOutline();
  if (inspectionFrame !== null) return;
  inspectionFrame = requestAnimationFrame(() => {
    inspectionFrame = null;
    renderLoupe(true);
  });
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
    drawLoupeOutline();
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
  loupeEpoch++; // Discard detail rendered with earlier settings or geometry.
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
    if (loupeCentre) renderLoupe();
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

loupe.addEventListener('pointerenter', () => {
  inspectionPanelHover = true;
  drawLoupeOutline();
});
loupe.addEventListener('pointerleave', () => {
  inspectionPanelHover = false;
  drawLoupeOutline();
});
inspectButton.addEventListener('click', () => {
  setTool(tool === 'inspect' ? 'move' : 'inspect', true);
  if (tool === 'inspect') preview.focus({ preventScroll: true });
});
document.getElementById('zoom-in').addEventListener('click', () => stepZoom(0.1));
document.getElementById('zoom-out').addEventListener('click', () => stepZoom(-0.1));
form.addEventListener('submit', (event) => event.preventDefault());

preview.addEventListener('pointerdown', (event) => {
  if (!last || event.button !== 0) return;
  preview.focus({ preventScroll: true });
  if (tool === 'inspect') {
    inspectPoint(event);
    setTool('move');
    return;
  }
  drag = { id: event.pointerId, start: sheetPoint(event), x: Number(form.elements.offsetX.value), y: Number(form.elements.offsetY.value) };
  preview.setPointerCapture(event.pointerId);
  preview.classList.add('dragging');
});
preview.addEventListener('pointermove', (event) => {
  if (tool === 'inspect') { inspectPoint(event); return; }
  if (!drag || event.pointerId !== drag.id) return;
  const point = sheetPoint(event);
  form.elements.offsetX.value = (drag.x + point[0] - drag.start[0]).toFixed(2);
  form.elements.offsetY.value = (drag.y + point[1] - drag.start[1]).toFixed(2);
  syncPosition();
  schedule(true);
});
preview.addEventListener('pointerenter', (event) => {
  if (tool === 'inspect') inspectPoint(event);
});
preview.addEventListener('pointerleave', () => {
  inspectionPointer = false;
  drawLoupeOutline();
});
window.addEventListener('resize', () => drawLoupeOutline());
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
  zoomMap(Number(form.elements.zoom.value) * Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002));
}, { passive: false });
preview.addEventListener('keydown', (event) => {
  if (!last || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === '+' || event.key === '=') { event.preventDefault(); stepZoom(0.1); }
  else if (event.key === '-') { event.preventDefault(); stepZoom(-0.1); }
  else if (event.key.toLowerCase() === 'i') { setTool(tool === 'inspect' ? 'move' : 'inspect'); }
  else if (event.key === 'Enter' && tool === 'inspect') {
    event.preventDefault();
    setTool('move');
  } else if (tool === 'inspect' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const p = readParams();
    const axis = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 0 : 1;
    const sign = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const crop = inspectionView(p, loupeCentre, LOUPE_PX);
    const full = fullView(p, p.dpi);
    loupeCentre = [(crop.x0 + crop.w / 2) / full.w, (crop.y0 + crop.h / 2) / full.h];
    loupeCentre[axis] = Math.max(0, Math.min(1, loupeCentre[axis] + sign * (event.shiftKey ? 5 : 1) / p.sheet[axis]));
    inspectionPointer = true;
    drawLoupeOutline();
    renderLoupe();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setTool('move', true);
});

// Hide every floating panel to look at the sheet alone (H, or the corner toggle).
const chromeToggle = document.getElementById('chrome-toggle');
function toggleChrome() {
  const hidden = document.body.classList.toggle('chrome-hidden');
  if (hidden) inspectionPanelHover = false;
  chromeToggle.textContent = hidden ? 'Show panels' : 'Hide panels';
  drawLoupeOutline();
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
  busy = true;
  exportBtn.disabled = true;
  const p = readParams();
  const writes = [];
  let writeError;
  try {
    const save = await chooseSaver(); // keep the original click's user activation
    const view = filmView(p, p.dpi);
    // Attach rejection handlers immediately, before the next film finishes rendering.
    const file = (f) => {
      const write = Promise.resolve().then(() => save(f)).catch(error => { writeError ??= error; });
      writes.push(write);
      return write;
    };
    let count;
    if (exportWorker.ok) {
      count = await exportWorker.request({ type: 'export', id: ++exportId, p, view }, { progress: status, file });
    } else {
      const xy = await ds.layout(p.layout);
      count = await renderFilms(ds, xy, p, view, { progress: async (msg) => { status(msg); await tick(); }, file });
    }
    await Promise.all(writes);
    if (writeError) throw writeError;
    status(`Exported ${count} film${count > 1 ? 's' : ''} + proof at ${p.dpi} dpi (${view.w} × ${view.h} px with registration bleed).`);
  } catch (err) {
    console.error(err);
    if (err.name !== 'AbortError') status(`Export failed: ${err.message}`);
  } finally {
    await Promise.all(writes);
    busy = false;
    exportBtn.disabled = false;
  }
});

restoreSettings();
syncPosition();
updateVisibility();
syncZoom();
setTool('move');
loadDataset(status)
  .then(async (data) => {
    ds = data;
    initializeSpotPalettes();
    const positions = await ds.layout('umap');
    const { n, meanCellArea, pointSizes, css, lum, cluster } = ds;
    const init = { type: 'init', dataset: { n, meanCellArea, pointSizes, css, lum, cluster }, positions };
    previewWorker.init(init);
    exportWorker.init(init);
    inspectionWorker.init(init);
    await update();
    form.querySelectorAll('.panel-settings').forEach((settings) => { settings.disabled = false; });
    inspectButton.disabled = false;
    syncPosition();
    syncZoom();
    exportBtn.disabled = false;
    document.getElementById('sheet').setAttribute('aria-busy', 'false');
  })
  .catch((err) => {
    console.error(err);
    status(`Could not load data/: ${err.message}. Check the connection and reload the page.`);
  });
