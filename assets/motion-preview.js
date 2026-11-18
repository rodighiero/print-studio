import { sheetGeometry } from './render.js';

// Move a cached proof inside the stationary sheet while the worker renders.
// Filling the entire sheet first also covers areas exposed by zooming out.
export function drawMotionPreview(ctx, snapshot, previous, current, background) {
  const old = sheetGeometry(previous), next = sheetGeometry(current);
  const scale = next.half / old.half;
  const x = (next.cx - old.cx * scale) * snapshot.width / current.sheet[0];
  const y = (next.cy - old.cy * scale) * snapshot.height / current.sheet[1];
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, snapshot.width, snapshot.height);
  ctx.drawImage(snapshot, x, y, snapshot.width * scale, snapshot.height * scale);
}
