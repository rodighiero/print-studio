# Surprise Machines — Screen Printing

A print studio that turns the [_Surprise Machines_](https://github.com/rodighiero/surprise-machines) visualization — 213,330 images from the Harvard Art Museums arranged by visual similarity — into screen-printing films.

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

`studio-settings.json` stores the project defaults and can be committed with the source. Fresh sessions load this file. Browser changes override these defaults, save automatically in local storage and are restored after a refresh, including map position, inks, output resolution and the selected preview film. Settings stay in the same browser and site address. The sheet is centred on the original Surprise Machines camera target (`x = 0.2`, `y = 0.1`), rather than the coordinate bounds. Older saved positions are centred once when upgrading to this behaviour.

Everything is laid out in sheet millimetres, so the same settings produce the same image at preview resolution, in the detail loupe and in the final export.

**Sheet** — A2 (420 × 594 mm) or A3 (297 × 420 mm), both portrait; zoom from 100% to 250% and read-only offset values, updated by dragging the map. The map has no reserved margin or caption.

**Layout** — UMAP, preserving the original collection’s arrangement by visual similarity.

**Render** — One dot per artwork, coloured by image colour, grey tone, cluster or solid.

**Mark sizing** — Dots automatically follow zoom and sheet format, using the original thumbnails’ mean area. Doubling zoom doubles the diameter and quadruples the area. “Constant” uses the same mean area for every dot. “By image darkness” multiplies dot area by image darkness. There is no manual size input. Preview, detail view and export share the same physical geometry. Subpixel circles use an equal-area coverage footprint to avoid disappearing or gaining density.

**Inks** — how the design is separated into screens:

| Mode | Screening |
|---|---|
| One colour | Halftone dots or line screen (LPI, angle), stochastic error diffusion, or threshold |
| Spot colours (1–4) | Nearest ink (flat) or dithered; cluster colours follow the ink palette so clusters separate cleanly |
| CMYK | Halftone at C 15°, M 75°, Y 0°, K 45°, with adjustable black generation |

The preview shows the whole sheet in continuous tone over the paper colour; switch it to any single film from the *Preview* menu. Drag the sheet to position the map, scroll to zoom, or use the zoom buttons. Offsets change only when dragging and remain fixed while zooming. The +/− keys also zoom. Select *Inspect detail* and click the sheet (or press Enter for the centre) to open a loupe that renders that area at export dpi with the real screen.

**Export** writes one black-on-white PNG film per ink plus a colour proof, at 300 or 400 dpi (A2 at 300 dpi = 4961 × 7016 px). The dpi is written into each PNG (`pHYs` chunk) so RIP and layout software size it correctly. Export runs in the browser and needs several hundred MB of memory.

## Data

`data/` holds the PixPlot output needed for printing (≈18 MB): the manifest, image list, layouts, cluster hotspots and the three image atlases. The 213,330 individual thumbnails (`data/thumbs/`, ≈1.4 GB) of the original repository are not included; the print studio reads images from the atlases.

## Structure

```
index.html              interactive Print Studio home page
studio-settings.json    committed project defaults
assets/print/
  data.js               loads data/, measures each image's average colour
  render.js             draws the dots in sheet mm
  separate.js           ink separation, screening, proofs
  export.js             PNG export with dpi metadata
  app.js                controls, preview, loupe, export
data/                   PixPlot output (see above)
vite.config.js          dev server on port 8000, studio build
```

## Credits

_Surprise Machines_ by Dario Rodighiero, Lins Derry, Douglas Duhaime, Jordan Kruguer, Maximilian C. Mueller, Christopher Pietsch, Jeffrey T. Schnapp, Jeff Steward, and metaLAB (at) Harvard, created for the exhibition _Curatorial A(i)gents_ (2022).

Rodighiero, D., Derry, L., Duhaime, D., Kruguer, J., Mueller, M. C., Pietsch, C., Schnapp, J. T., Steward, J., & metaLAB. (2022). Surprise Machines: Revealing Harvard Art Museums' image collection. _Information Design Journal_, 27(1), 21–34. <https://doi.org/10.1075/idj.22013.rod>

## License

The code is distributed under the MIT License (see `LICENSE`). The collection layouts and atlases were generated with [PixPlot](https://github.com/YaleDHLab/pix-plot) by the Yale Digital Humanities Lab. The Harvard Art Museums collection — images, metadata, and provenance — remains the property of the Harvard Art Museums and is presented here for research and educational purposes.
