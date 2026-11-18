import projectSettings from '../../studio-settings.json';
import { drawMotionPreview } from './motion-preview.js';
import { inspectionView } from './inspection.js';
import { extractPalette } from './palette.js';
import { contrastPalette } from './palette-contrast.js';
import { loadDataset } from './data.js';
import { renderDesign, fullView, filmView, layoutCentre } from './render.js';
import { separate, composite, film, addMarks } from './separate.js';
import { renderFilms, chooseSaver, filmFileName } from './export.js';

const PREVIEW_DPI = 60;
// Films are always 300 dpi; dot sizes, not resolution, vary between exports.
const EXPORT_DPI = 300;
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
const sheetGrid = document.getElementById('sheet-grid');
const sheetGridFine = document.getElementById('sheet-grid-fine');
const FINE_GRID_MM = 50;
const bleedCanvas = document.getElementById('bleed');
const inspectHelp = document.getElementById('inspect-help');
// The loupe shows the sheet at actual size: the canvas's on-screen width,
// in CSS inches (96 CSS px each), sets how much of the sheet it covers.
// Before layout (width 0) it falls back to the panel's usual 178 px.
const CSS_PX_PER_INCH = 96;
function loupeSize(p) {
  const width = loupeCanvas.getBoundingClientRect().width || 178;
  return Math.max(16, Math.round(width / CSS_PX_PER_INCH * p.dpi));
}

let ds = null;
let last = null;        // { p, view, layers } of the current preview
let loupeCentre = [0.5, 0.5]; // selected center as fractions of sheet width/height
let inspectionPointer = false;
let inspectionPanelHover = false;
let inspectionFrame = null;
let selectedCentre = [...loupeCentre];
let imageCentre; // layout centre of the image, set once the layout loads
let restorePanelsHidden = false; // set by applySettings, applied once the page is ready
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
  return { layers: separate(renderDesign(ds, xy, p, view), p, view, true) };
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
    // While choosing an area, keep the last committed one; a cancel returns to it.
    const inspect = tool === 'inspect' ? selectedCentre : loupeCentre;
    const panelsHidden = document.body.classList.contains('chrome-hidden');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ values, ...calibration, view: selectedView, inspect, panelsHidden, positionVersion: 3, zoomRangeVersion: 2 }));
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
    // Re-centre older saved positions once: offsets are now relative to the image centre.
    // Later saves retain manual positioning across refreshes.
    if (saved.positionVersion !== 3) {
      form.elements.offsetX.value = '0';
      form.elements.offsetY.value = '0';
    }
    // Move older saves to the current default zoom once; retain later user choices.
    if (saved.zoomRangeVersion !== 2) form.elements.zoom.value = projectSettings.values.zoom;
    if (typeof saved.view === 'string') selectedView = saved.view;
    const inspect = saved.inspect;
    if (Array.isArray(inspect) && inspect.length === 2 && inspect.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
      loupeCentre = [...inspect];
      selectedCentre = [...inspect];
    }
    if (saved.panelsHidden === true) restorePanelsHidden = true;
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

const percent = (value) => `${Math.round(Number(value) * 100)}%`;
// Dot sizes: size 1 is always exported; sizes 2 and 3 are optional extra sets.
// The selected (bulleted) size is the one shown in the preview.
const sizeName = (i) => (i === 1 ? 'markSize' : `markSize${i}`);
const sizeRadio = (i) => form.querySelector(`input[name="sizePreview"][value="${i}"]`);
const sizeValue = (i) => clampNum(parseFloat(form.elements[sizeName(i)].value), 0.25, 4, 1);
// Sizes to export; a size equal to an earlier one is skipped, since it would write the same files.
const enabledSizes = () => [1, 2, 3]
  .filter((i) => i === 1 || form.elements[`sizeOn${i}`].checked)
  .filter((i, n, sizes) => sizes.findIndex((j) => Math.round(sizeValue(j) * 100) === Math.round(sizeValue(i) * 100)) === n);
// Export parameters for size i; with several sizes, files carry the dot size percentage.
function sizedParams(p, i, sizes) {
  const markSize = sizeValue(i);
  return { ...p, markSize, fileTag: sizes.length > 1 ? `dot-${Math.round(markSize * 100)}` : undefined };
}
// List the files the next export will write, below the Export button.
const fileNames = document.getElementById('file-names');
function syncFileNames() {
  if (!last) return;
  const p = readParams();
  const sizes = enabledSizes();
  const names = sizes.flatMap((i) => last.layers.map((layer, n) => filmFileName(sizedParams(p, i, sizes), layer, n)));
  fileNames.replaceChildren(...names.map((name) => Object.assign(document.createElement('li'), { textContent: name })));
  fileNames.hidden = false;
}
function syncSizes() {
  for (const i of [1, 2, 3]) document.getElementById(`mark-size-${i}-level`).value = percent(form.elements[sizeName(i)].value);
  for (const i of [2, 3]) {
    const radio = sizeRadio(i);
    radio.disabled = !form.elements[`sizeOn${i}`].checked;
    if (radio.disabled && radio.checked) sizeRadio(1).checked = true;
  }
}
// Moving a slider or enabling a size previews it.
function previewSize(target) {
  const i = { markSize: 1, markSize2: 2, markSize3: 3, sizeOn2: 2, sizeOn3: 3 }[target.name];
  if (i && !sizeRadio(i).disabled) sizeRadio(i).checked = true;
}
function syncZoom() {
  const zoom = form.elements.zoom;
  zoomLevel.value = `${Math.round(Number(zoom.value) * 100)}%`;
  document.getElementById('zoom-out').disabled = !ds || Number(zoom.value) <= Number(zoom.min);
  document.getElementById('zoom-in').disabled = !ds || Number(zoom.value) >= Number(zoom.max);
}
function setTool(next, cancel = false) {
  if (next === 'inspect' && tool !== 'inspect') {
    selectedCentre = [...loupeCentre];
    if (drag) endDrag(drag.id);
  }
  if (cancel && tool === 'inspect') {
    loupeCentre = [...selectedCentre];
    renderLoupe();
  }
  tool = next;
  preview.dataset.tool = next;
  saveSettings(); // keep the chosen inspection area
  inspectButton.setAttribute('aria-pressed', String(next === 'inspect'));
  inspectButton.textContent = next === 'inspect' ? 'Cancel' : 'Select area';
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
// Restore every ink to its default: spot palettes regenerate from the original image colors.
document.getElementById('reset-inks').addEventListener('click', () => {
  if (!palettesReady) return;
  for (const el of form.elements) {
    if (isSpotColor(el.name) || el.name === 'monoInk') el.value = settingDefaults[el.name];
  }
  spotColorOverrides.clear();
  schedule();
});
// Offsets are 0 when the image centre sits on the sheet centre.
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
const previewStatus = (msg) => { if (!busy) status(msg); };
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
    centre: imageCentre,
    colorBy: el.colorBy.value,
    sizeBy: 'constant',
    markSize: sizeValue(Number(el.sizePreview.value) || 1),
    inkMode,
    inks,
    paper: el.paper.value,
    spotMethod: el.spotMethod.value,
    // Tiny marks are screened stochastically: AM cells would break them apart.
    screen: 'fs',
    dpi: EXPORT_DPI,
    bleed: el.bleed.checked,
  };
}

// data-show="inkMode=spot2,spot3" -> visible when every clause matches
function updateVisibility() {
  form.querySelectorAll('[data-show]').forEach((node) => {
    const ok = node.dataset.show.split(';').every((clause) => {
      const [name, values] = clause.split('=');
      const el = form.elements[name];
      return values.split(',').includes(el.type === 'checkbox' ? String(el.checked) : el.value);
    });
    node.hidden = !ok;
  });
}

// Layers are named "ink" (one color) or "ink1", "ink2"… (spot colors).
const filmLabel = (name) => name === 'composite' ? 'Composite' : name.replace(/^ink(\d*)$/, (_, n) => n ? `Ink ${n}` : 'Ink');

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
    text.textContent = filmLabel(value);
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
  const { p, view, layers } = last;
  preview.width = view.w;
  preview.height = view.h;
  const ctx = preview.getContext('2d');
  const image = viewImage(layers, p, view.w, view.h);
  previewSnapshot.width = view.w;
  previewSnapshot.height = view.h;
  const snapshotCtx = previewSnapshot.getContext('2d');
  snapshotCtx.putImageData(image, 0, 0);
  ctx.drawImage(previewSnapshot, 0, 0);
  const label = selectedView === 'composite' ? 'Composite of all inks' : `${filmLabel(selectedView)} film`;
  document.getElementById('sheet').setAttribute('aria-label', label);
  drawGrid();
  drawBleed();
  drawLoupeOutline();
}

// The grid guides cover the sheet canvas exactly; they are overlays, so they never reach the films.
// The two grids are independent and can be shown together.
function drawGrid() {
  const rect = preview.getBoundingClientRect();
  const frame = preview.parentElement.getBoundingClientRect();
  const place = (svg, on) => {
    // An SVG element has no .hidden property; toggle the attribute instead.
    svg.toggleAttribute('hidden', !last || !on);
    if (!last || !on) return false;
    Object.assign(svg.style, {
      left: `${rect.left - frame.left}px`, top: `${rect.top - frame.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
    return true;
  };
  place(sheetGrid, form.elements.grid.checked);
  if (place(sheetGridFine, form.elements.gridFine.checked)) {
    // Drawn in sheet millimetres, from the centre outwards.
    const [W, H] = readParams().sheet;
    const lines = (length, step) => {
      const out = [];
      for (let d = 0; length / 2 + d < length; d += step) out.push(length / 2 + d, ...(d ? [length / 2 - d] : []));
      return out;
    };
    const d = [
      ...lines(W, FINE_GRID_MM).map((x) => `M${x} 0V${H}`),
      ...lines(H, FINE_GRID_MM).map((y) => `M0 ${y}H${W}`),
    ].join('');
    sheetGridFine.setAttribute('viewBox', `0 0 ${W} ${H}`);
    sheetGridFine.firstElementChild.setAttribute('d', d);
  }
}

// Show the film bleed around the sheet: the same marks as the films, drawn at
// screen resolution behind the sheet canvas, which covers everything but the band.
let bleedKey = '';
function drawBleed() {
  const p = last && readParams();
  bleedCanvas.hidden = !p || !p.bleed;
  if (bleedCanvas.hidden) return;
  const rect = preview.getBoundingClientRect();
  const frame = preview.parentElement.getBoundingClientRect();
  const cssPerMm = rect.width / p.sheet[0];
  const view = filmView(p, cssPerMm * 25.4 * (window.devicePixelRatio || 1));
  // Redraw the marks only when the band's pixel size changes (format, window size, zoom level of the page).
  const key = `${view.w}x${view.h}`;
  if (key !== bleedKey) {
    bleedKey = key;
    const marks = { data: new Uint8Array(view.w * view.h) };
    addMarks([marks], view);
    bleedCanvas.width = view.w;
    bleedCanvas.height = view.h;
    const image = new ImageData(view.w, view.h);
    for (let i = 0, o = 0; i < marks.data.length; i++, o += 4) {
      // Only the marks: the band itself stays the page background.
      if (marks.data[i]) image.data.set([30, 30, 30, 230], o);
    }
    bleedCanvas.getContext('2d').putImageData(image, 0, 0);
  }
  const scale = rect.width / view.trim.w;
  Object.assign(bleedCanvas.style, {
    left: `${rect.left - frame.left + view.x0 * scale}px`, top: `${rect.top - frame.top + view.y0 * scale}px`,
    width: `${view.w * scale}px`, height: `${view.h * scale}px`,
  });
}

function drawLoupeOutline() {
  inspectionArea.hidden = !last || (!inspectionPanelHover && (tool !== 'inspect' || !inspectionPointer));
  if (inspectionArea.hidden) return;
  const p = readParams();
  const view = inspectionView(p, loupeCentre, loupeSize(p));
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
  previewStatus('Rendering preview…');
  await tick();
  const xy = await ds.layout(p.layout);
  if (request !== revision) return;
  const view = fullView(p, PREVIEW_DPI);
  const { layers } = await renderPreview(xy, p, view, request);
  if (request !== revision) return;
  last = { p, view, layers };
  populateViews(layers);
  syncFileNames();
  drawPreview();
  if (loupeCentre) await renderLoupe();
  if (request !== revision) return;
  const exportPx = filmView(p, p.dpi);
  previewStatus(`${exportPx.w} × ${exportPx.h} px`);
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
      const view = inspectionView(p, loupeCentre, loupeSize(p));
      const which = selectedView;
      let result;
      try {
        if (inspectionWorker.ok) result = await inspectionWorker.request({
          type: 'inspect', id: request, p, view,
        });
      } catch (error) {
        if (inspectionWorker.ok) throw error;
        console.warn('Inspection worker unavailable, rendering on the main thread.', error);
      }
      if (epoch !== loupeEpoch) continue;
      if (!result) {
        const xy = await ds.layout(p.layout);
        if (epoch !== loupeEpoch) continue;
        result = { layers: separate(renderDesign(ds, xy, p, view), p, view, false) };
      }
      if (loupeCanvas.width !== view.w) loupeCanvas.width = view.w;
      if (loupeCanvas.height !== view.h) loupeCanvas.height = view.h;
      loupeCanvas.getContext('2d').putImageData(viewImage(result.layers, p, view.w, view.h, which), 0, 0);
      const mm = (view.w / p.dpi * 25.4).toFixed(0);
      loupeCaption.textContent = `${mm} × ${mm} mm · actual size · ${p.dpi} dpi`;
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
    const background = last.layers.some(layer => layer.name === selectedView) ? '#ffffff' : last.p.paper;
    drawMotionPreview(preview.getContext('2d'), previewSnapshot, last.p, p, background);
    drawLoupeOutline();
  });
}
async function flushPreview() {
  if (updating) { pendingUpdate = true; return; }
  updating = true;
  pendingUpdate = false;
  try { await update(); }
  catch (err) { console.error(err); previewStatus(`Could not render preview: ${err.message}`); }
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
  if (e.target.name === 'grid' || e.target.name === 'gridFine') { drawGrid(); saveSettings(); return; }
  updateVisibility();
  syncZoom();
  syncSizes();
  previewSize(e.target);
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
// A wider or narrower loupe covers more or less of the sheet, still at actual size.
window.addEventListener('resize', () => {
  drawGrid();
  drawBleed();
  drawLoupeOutline();
  if (loupeCentre && last && loupeCanvas.width !== loupeSize(readParams())) renderLoupe();
});
function endDrag(pointerId) {
  if (!drag || pointerId !== drag.id) return;
  drag = null;
  preview.classList.remove('dragging');
  if (preview.hasPointerCapture(pointerId)) preview.releasePointerCapture(pointerId);
  schedule();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  preview.addEventListener(type, (event) => endDrag(event.pointerId));
}
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
    const crop = inspectionView(p, loupeCentre, loupeSize(p));
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
  drawGrid();
  drawBleed();
  drawLoupeOutline();
  saveSettings();
}
chromeToggle.addEventListener('click', toggleChrome);
document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (!['h', 'g'].includes(key) || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest?.('input:not([type=radio]), textarea, select')) return;
  if (key === 'h') { toggleChrome(); return; }
  form.elements.grid.checked = !form.elements.grid.checked;
  drawGrid();
  saveSettings();
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
    const sizes = enabledSizes();
    let count;
    for (const [n, i] of sizes.entries()) {
      const sized = sizedParams(p, i, sizes);
      const { markSize } = sized;
      const progress = (msg) => status(sizes.length > 1 ? `Size ${i} (${n + 1}/${sizes.length}, ${percent(markSize)}) · ${msg}` : msg);
      if (exportWorker.ok) {
        count = await exportWorker.request({ type: 'export', id: ++exportId, p: sized, view }, { progress, file });
      } else {
        const xy = await ds.layout(p.layout);
        count = await renderFilms(ds, xy, sized, view, { progress: async (msg) => { progress(msg); await tick(); }, file });
      }
      if (writeError) break;
    }
    await Promise.all(writes);
    if (writeError) throw writeError;
    const sets = sizes.length > 1 ? `${sizes.length} dot sizes × ` : '';
    status(`Exported ${sets}${count} film${count > 1 ? 's' : ''} at ${p.dpi} dpi (${view.w} × ${view.h} px${p.bleed ? ' with registration bleed' : ''}).`);
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
if (restorePanelsHidden) toggleChrome();
syncPosition();
updateVisibility();
syncZoom();
syncSizes();
setTool('move');
loadDataset(status)
  .then(async (data) => {
    ds = data;
    initializeSpotPalettes();
    const positions = await ds.layout('umap');
    imageCentre = layoutCentre(positions);
    const { n, meanCellArea, pointSizes, css, lum } = ds;
    const init = { type: 'init', dataset: { n, meanCellArea, pointSizes, css, lum }, positions };
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
