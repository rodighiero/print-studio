# Print Studio

A print studio that turns data visualizations into screen-printing films. Projects are chosen from the *Project* menu; the first (and for now only) one is the [_Surprise Machines_](https://github.com/rodighiero/surprise-machines) visualization — 213,330 images from the Harvard Art Museums arranged by visual similarity.

The interactive Print Studio lives at `index.html`. It renders the collection onto a print sheet (A2 by default), separates it into inks, and exports one film per screen as a high-resolution PNG.

## Getting started

Requires Node.js.

```sh
npm install
npm run dev        # http://localhost:8000/
npm test           # mark sizing and print geometry checks
npm run build      # static site in dist/
npm run preview    # serve dist/ on port 8000
```

The studio fetches `data/` at runtime, so it must be served over HTTP (not opened as `file://`).

## Print Studio

`studio-settings.json` stores the project defaults and can be committed with the source. Fresh sessions load this file. Browser changes override these defaults, save automatically in local storage (only the values that differ from the defaults, so untouched settings follow later changes to the file) and are restored after a refresh, including map position, inks, output resolution, the selected preview film, and whether the Inspect area outline is shown. Settings stay in the same browser and site address. The sheet is centered on the original Surprise Machines camera target (`x = 0.2`, `y = 0.1`), rather than the coordinate bounds. Older saved positions are centered once when upgrading to this behavior.

Everything is laid out in sheet millimeters, so the same settings produce the same image at preview resolution, in the detail loupe and in the final export.

**Sheet** — A2 (420 × 594 mm) or A3 (297 × 420 mm), both portrait; zoom from 100% to 250% and read-only offset values, updated by dragging the map. The map has no reserved margin or caption.

**Layout** — UMAP, preserving the original collection’s arrangement by visual similarity.

**Colors** — Color each artwork dot by image color, gray tone, or solid black.

**Mark sizing** — Dots automatically follow zoom and sheet format, using the original thumbnails’ mean area. Doubling zoom doubles the diameter and quadruples the area. Every dot uses the same mean area. There is no manual size input. Preview, detail view and export share the same physical geometry. Subpixel circles use an equal-area coverage footprint to avoid disappearing or gaining density.

**Inks** — how the design is separated into screens:

| Mode | Screening |
|---|---|
| One color | Halftone dots or line screen (LPI, angle), stochastic screening, or threshold |
| Spot colors (1–4) | Nearest ink (flat) or dithered |
| CMYK | Halftone at C 15°, M 75°, Y 0°, K 45°, with adjustable black generation |

The sheet fills the window and the controls float over it in two side columns, one panel per concern: composition (including format and zoom), Colors, and the Inspect panel with canvas tools on the left; inks, screening, preview and export on the right. Press H (or *Hide panels*) to see the sheet alone. *Reset position* re-centers the map. The *Print preview* toggle switches the center image between a smooth proof with the selected inks and the original design colors. A label on the sheet identifies the active view. Preview view offers the composite or any single film while Print preview is enabled. The toggle is saved across refreshes; it affects only the center image, so Inspect and exports retain the actual screened output. Drag the sheet to position the map, scroll to zoom, or use the zoom buttons. Offsets change only when dragging and remain fixed while zooming. The +/− keys also zoom. The *Inspect* panel always shows a selected area at export dpi with the real screen, starting at the sheet center. Choose *Select area* in that panel (or press I on the sheet), then click the sheet to move the selection; Enter selects the center and Escape returns to Move. The selection stays visible while moving or zooming the map and follows changes to inks, format and resolution.

**Export** writes one black-on-white PNG film per ink plus a color proof, at 300 or 400 dpi. Every film is pure black and white. Films extend 10 mm past the sheet on each side; this bleed carries identical registration targets (centered on each edge) and crop marks on every film, while the artwork stays clipped to the sheet (A2 at 300 dpi = 4961 × 7016 px sheet, 5197 × 7252 px film). The dpi is written into each PNG (`pHYs` chunk) so RIP and layout software size it correctly. In browsers that support it (Chrome, Edge) you pick a folder once and all files are written there; elsewhere each file downloads. Export renders in a background worker and needs several hundred MB of memory.

All screens and dithers are anchored to absolute sheet pixels, so the loupe shows exactly the pixels the export will contain. *Stochastic* is a dispersed-noise (FM) screen; *Dithered* spot separation is an ordered dither to the ink palette. Flat spot separation picks the nearest ink (or paper) by mark color and converts partial coverage — antialiased edges and subpixel thumbnails — to film pixels with the same stochastic threshold, so density is preserved without gray pixels. Colors are matched against the chosen paper color, not white.

## Data

`data/` holds the PixPlot output needed for printing (≈18 MB): the manifest, image list, layouts, cluster hotspots and the three image atlases. The 213,330 individual thumbnails (`data/thumbs/`, ≈1.4 GB) of the original repository are not included; the print studio reads images from the atlases.

## Structure

```
index.html              interactive Print Studio home page
studio-settings.json    committed project defaults
assets/print/
  data.js               loads data/, measures each image's average color
  render.js             draws the dots in sheet mm
  separate.js           ink separation, screening, proofs
  export.js             film/proof rendering, PNG export with dpi metadata, saving
  preview-worker.js     background worker for previews and exports
  motion-preview.js     moves the last preview while dragging/zooming
  app.js                controls, preview, loupe, export (falls back to the main thread if workers fail)
data/                   PixPlot output (see above)
vite.config.js          dev server on port 8000, studio build
```

## Credits

_Surprise Machines_ by Dario Rodighiero, Lins Derry, Douglas Duhaime, Jordan Kruguer, Maximilian C. Mueller, Christopher Pietsch, Jeffrey T. Schnapp, Jeff Steward, and metaLAB (at) Harvard, created for the exhibition _Curatorial A(i)gents_ (2022).

Rodighiero, D., Derry, L., Duhaime, D., Kruguer, J., Mueller, M. C., Pietsch, C., Schnapp, J. T., Steward, J., & metaLAB. (2022). Surprise Machines: Revealing Harvard Art Museums' image collection. _Information Design Journal_, 27(1), 21–34. <https://doi.org/10.1075/idj.22013.rod>

## License

The code is distributed under the MIT License (see `LICENSE`). The collection layouts and atlases were generated with [PixPlot](https://github.com/YaleDHLab/pix-plot) by the Yale Digital Humanities Lab. The Harvard Art Museums collection — images, metadata, and provenance — remains the property of the Harvard Art Museums and is presented here for research and educational purposes.
