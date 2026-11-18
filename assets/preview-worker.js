// Renders previews and full-resolution exports off the main thread.
import { renderDesign } from './render.js';
import { separate } from './separate.js';
import { renderFilms } from './export.js';

let dataset;
let positions;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    dataset = data.dataset;
    positions = data.positions;
    return;
  }
  const { id, p, view } = data;
  try {
    if (data.type === 'export') {
      const done = await renderFilms(dataset, positions, p, view, {
        progress: (message) => self.postMessage({ id, progress: message }),
        file: (file) => self.postMessage({ id, file }),
      });
      self.postMessage({ id, done });
      return;
    }
    // Inspection shows real film pixels; the sheet preview keeps continuous coverage.
    const layers = separate(renderDesign(dataset, positions, p, view), p, view, data.type !== 'inspect');
    self.postMessage({ id, preview: { layers } }, layers.map(layer => layer.data.buffer));
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
