# Surprise Machines — Screen Printing

A print studio that turns the [_Surprise Machines_](https://github.com/rodighiero/surprise-machines) visualization — 213,330 images from the Harvard Art Museums arranged by visual similarity — into screen-printing films.

The repository contains two pages:

- **`print.html` — Print Studio.** Renders the UMAP map of the collection onto a print sheet (A2 by default), separates it into inks, and exports one film per screen as a high-resolution PNG.
- **`index.html` — the original viewer.** The interactive WebGL visualization, built on [PixPlot](https://github.com/YaleDHLab/pix-plot), copied from `main` of the original repository.

## Getting started

Requires Node.js.

```sh
npm install
npm run dev        # http://localhost:8000/print.html  (viewer at /)
npm run build      # static site in dist/
npm run preview    # serve dist/ on port 8000
```

The pages fetch `data/` at runtime, so they must be served over HTTP (not opened as `file://`).

## Print Studio

Everything is laid out in sheet millimetres, so the same settings produce the same image at preview resolution, in the detail loupe and in the final export.

**Sheet** — A2 portrait/landscape, 18 × 24 in or A3; margin, zoom and offset of the map; a caption line; registration marks added to every film.

**Layout** — UMAP, jittered UMAP, Rasterfairy grid or alphabetic grid.

**Render** — how each of the 213,330 images is drawn:

| Mode | Description |
|---|---|
| Thumbnails | Each artwork drawn from the atlases at a given size in mm. Source cells are only 6 px tall, so at close range they read as texture. |
| Dots | One dot per artwork, coloured by image colour, grey tone, cluster, or solid; dot area can follow the artwork's darkness. |
| Density field | A blurred density map of the collection, continuous or in stepped bands, coloured by mean image colour or by the dominant cluster. |

**Inks** — how the design is separated into screens:

| Mode | Screening |
|---|---|
| One colour | Halftone dots or line screen (LPI, angle), stochastic error diffusion, or threshold |
| Spot colours (1–4) | Nearest ink (flat) or dithered; cluster colours follow the ink palette so clusters separate cleanly |
| CMYK | Halftone at C 15°, M 75°, Y 0°, K 45°, with adjustable black generation |

The preview shows the whole sheet in continuous tone over the paper colour; switch it to any single film from the *Preview* menu. Click the sheet to open a loupe that renders that area at export dpi with the real screen.

**Export** writes one black-on-white PNG film per ink plus a colour proof, at 300 or 400 dpi (A2 at 300 dpi = 4961 × 7016 px). The dpi is written into each PNG (`pHYs` chunk) so RIP and layout software size it correctly. Export runs in the browser and needs several hundred MB of memory.

## Data

`data/` holds the PixPlot output needed for printing (≈19 MB): the manifest, image list, layouts, cluster hotspots and the three image atlases. The 213,330 individual thumbnails (`data/thumbs/`, ≈1.4 GB) of the original repository are not included; the print studio reads images from the atlases. The original viewer draws the map from the atlases too, but the thumbnails in its cluster and selection panels (which load from `data/thumbs/`) will be missing.

## Structure

```
print.html              Print Studio page
assets/print/
  data.js               loads data/, measures each image's average colour
  render.js             draws the design (thumbnails, dots, density) in sheet mm
  separate.js           ink separation, screening, registration marks, proofs
  export.js             PNG export with dpi metadata
  app.js                controls, preview, loupe, export
index.html              original WebGL viewer
assets/js/tsne.js       viewer code (PixPlot)
assets/vendor/          viewer libraries — versions in assets/vendor/VERSIONS.md
data/                   PixPlot output (see above)
vite.config.js          dev server on port 8000, multi-page build
```

## Credits

_Surprise Machines_ by Dario Rodighiero, Lins Derry, Douglas Duhaime, Jordan Kruguer, Maximilian C. Mueller, Christopher Pietsch, Jeffrey T. Schnapp, Jeff Steward, and metaLAB (at) Harvard, created for the exhibition _Curatorial A(i)gents_ (2022).

Rodighiero, D., Derry, L., Duhaime, D., Kruguer, J., Mueller, M. C., Pietsch, C., Schnapp, J. T., Steward, J., & metaLAB. (2022). Surprise Machines: Revealing Harvard Art Museums' image collection. _Information Design Journal_, 27(1), 21–34. <https://doi.org/10.1075/idj.22013.rod>

## License

The viewer code is built on [PixPlot](https://github.com/YaleDHLab/pix-plot) by the Yale Digital Humanities Lab and is distributed under the MIT License (see `LICENSE`). The Harvard Art Museums collection — images, metadata, and provenance — remains the property of the Harvard Art Museums and is presented here for research and educational purposes.
