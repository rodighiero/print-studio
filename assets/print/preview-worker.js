import { renderDesign } from './render.js';
import { separate } from './separate.js';

let dataset;
let positions;
self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    dataset = data.dataset;
    positions = data.positions;
    return;
  }
  const { id, p, view } = data;
  try {
    const image = renderDesign(dataset, positions, p, view, p.palette);
    const layers = separate(image, p, view, true);
    self.postMessage({ id, layers }, layers.map(layer => layer.data.buffer));
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
