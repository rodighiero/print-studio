# Print Studio

[**Open Print Studio →**](https://rodighiero.github.io/print-studio/)

Print Studio turns data visualizations into films for screen printing. Compose a print sheet, choose your inks, inspect the screened detail, and export one film per ink.

The first project is [*Surprise Machines*](https://github.com/rodighiero/surprise-machines): **213,330 images from the Harvard Art Museums**, arranged by visual similarity. Each artwork becomes a dot whose color comes from its source image, translating the collection into a printable landscape.

![Print Studio showing the Surprise Machines visualization in solid black on an A2 sheet, with the center and thirds grid, bleed registration marks, three dot sizes, the actual-size Inspect panel, one-color ink settings, and the list of files to export.](docs/images/print-studio.png)

*Surprise Machines in one color on an A2 sheet, with the center and thirds grid and bleed marks shown. Inspect shows a selected area at actual size; three dot sizes are set for export.*

## Getting started

Requires **Node.js 22.12 or later** and npm.

```sh
npm install
npm run dev
```

Open [localhost:8000](http://localhost:8000/). The studio loads its collection from `data/` over HTTP; opening `index.html` directly from the filesystem will not load the data.

To create and preview a production build:

```sh
npm run build
npm run preview
```

The source repository is available at [github.com/rodighiero/print-studio](https://github.com/rodighiero/print-studio). The build includes the collection data in `dist/`, ready for static hosting. Stop the development server before running the preview server; both use port 8000.

The [live studio](https://rodighiero.github.io/print-studio/) is hosted on GitHub Pages. Pushes to `main` run the tests, build the studio with its collection data, and deploy it through [GitHub Actions](.github/workflows/pages.yml).

## Compose a print

The left panels set what is printed and where.

- **Project** chooses the visualization. Its **Dot size** scales each artwork's dot diameter from 25% to 400% of the original thumbnails' mean size in the Surprise Machines viewer. Size 1 is always exported; check **Size 2** or **Size 3** to export extra sets of films at those sizes. The bulleted size is the one shown in the preview; clicking a size, moving its slider, or checking it selects it.
- **Format** sets the sheet to **A2 (420 × 594 mm)** or **A3 (297 × 420 mm)**, both portrait. **Zoom** ranges from 100% to 500%; use the slider, scroll on the sheet, or the **+** and **−** buttons (10 percentage points).
- **Position** shows the offset of the image from the sheet center. Drag the sheet to move the image; **Reset** centers it again.
- **Colors** sets the source design: image color, gray tone, or solid black.

The UMAP layout preserves the collection's arrangement by visual similarity. Dots keep a consistent physical area, so their size follows the sheet format and zoom automatically.

The image is centered on its main body: the middle of the area holding 99% of the points, leaving out stray points at the layout edges and the small cluster detached below the rest. That cluster is not removed; at higher zoom it falls past the sheet edge.

## Preview and inks

The sheet always shows the print in the selected inks on the paper color. Its preview is drawn at 60 dpi, so it shows tone rather than individual dots; use **Inspect** to see the dots.

| Ink choice | Separation and screening |
| --- | --- |
| One color | Choose an ink; tones are rendered with a stochastic screen. |
| 2 spot colors | Separate into two inks using flat nearest-color matching or dithering. |
| 3 spot colors | Separate into three inks using flat nearest-color matching or dithering. |

The two spot palettes are generated independently from the original artwork colors. Similar hues are spread apart in [Oklab](https://bottosson.github.io/posts/oklab/) while keeping their perceived lightness and saturation consistent. Saturation is reduced where necessary to stay within the display color range. Each palette remains editable and keeps its own colors when switching ink choices. **Reset**, next to the Inks title, restores every ink to its default, regenerating both spot palettes from the original image colors.

Choose the **Paper** color separately; color matching accounts for it. One-color films use a stochastic (FM) screen, which keeps the tiny image marks intact; an AM halftone cell would be larger than most marks and break them apart.

**Films** switches the preview between the composite and each ink's film. **Sheet** holds two more options:

- **Bleed 10 mm** extends every film 10 mm past the sheet, carrying registration targets and crop marks. The preview shows the marks around the sheet. Uncheck it to export films cut exactly to the sheet, without marks.
- **Grid** overlays center and rule-of-thirds guides; **Grid 50 mm** adds thinner lines every 50 mm from the sheet center. The two can be shown alone or together. Guides never print.

## Inspect the detail

The **Inspect** panel shows a selected area of the actual screened output for the selected film, rendered at 300 dpi and displayed at actual size: the area it covers matches the panel's on-screen width at the browser's standard 96 CSS pixels per inch, so the dots appear about as large as they will print. Many laptop screens show CSS pixels smaller than standard, so the detail can look slightly smaller than true size. A wider panel, as on narrow windows, covers a larger area.

Click **Select area**, next to the Inspect title, to replace the pointer with a square matching the inspection area. Move across the sheet to update the detail live, then click to keep an area and return to dragging. **Escape** or **Cancel** restores the previous selection. Hover over the Inspect panel to highlight its area on the sheet.

| Control | Action |
| --- | --- |
| Drag | Move the composition. |
| Scroll | Zoom smoothly. |
| `+` / `−` | Zoom by 10 percentage points. |
| `I` on the sheet | Toggle inspection. |
| Arrow keys while inspecting | Move the inspection square; hold Shift for larger steps. |
| Enter while inspecting | Keep the selected area and return to dragging. |
| Escape | Cancel inspection. |
| `G` | Show or hide the center and thirds grid. |
| `H` | Hide or show the panels. |

## Export films

Click **Export films** to write one pure black-on-white PNG film per ink, at **300 dpi**, for each exported dot size. Each PNG embeds its resolution so print and layout software recover the intended physical size. Artwork stays clipped to the sheet. At A2, the sheet is 4961 × 7016 pixels; with the bleed, each film is 5197 × 7252 pixels. The film size is shown below the button.

The file names the export will write are listed below the button and update with the format, inks, and dot sizes:

| Setup | File names |
| --- | --- |
| One color, one size | `surprise-machines_A2.png` |
| One color, several sizes | `surprise-machines_A2_dot-100.png`, `surprise-machines_A2_dot-150.png` |
| Spot colors | `surprise-machines_A2_3inks_ink-1-e4572e.png`, one per ink, with its color |

With several dot sizes, a size equal to another is exported once. Where the browser supports folder selection, choose a destination once for all files; otherwise, files download individually. Full-resolution exports run in a background worker and can use several hundred megabytes of memory.

## Settings and rendering

[`studio-settings.json`](studio-settings.json) defines the project defaults. Browser changes save automatically in local storage and return after a refresh, including composition, dot sizes, colors, inks, paper, bleed and grids, the selected film, the inspected area, and whether the panels are hidden. Only overrides are saved, so untouched controls follow future default changes. Settings are specific to the browser and site address; saved edits to generated palettes override their generated defaults.

Geometry is defined in sheet millimeters and shared by the preview, inspection crop, and export. Screens and dithers are anchored to absolute sheet pixels so an inspection crop matches the corresponding exported area. Subpixel dots preserve their physical coverage. Flat and dithered spot separation preserve partial mark coverage as binary film pixels, keeping faint dots visible without introducing gray into the films. Fully covered marks remain solid across all screen phases.

Preview, inspection, and export use separate workers. Rendering falls back to the main thread if a worker cannot start; an export interrupted by a worker crash reports an error and can be retried.

## Development and data

Run the checks with:

```sh
npm test
```

The tests cover collection loading, physical mark sizing, image centering, crop consistency, palette generation and contrast, ink separation, screening, registration marks, motion previews, PNG resolution metadata, export file names, and asynchronous export failures.

`data/` contains approximately 18 MB of PixPlot output: the manifest, image list, layout, cluster hotspots, and three image atlases. Cluster hotspots are retained as source data but are no longer required by the studio. The 213,330 individual thumbnails from the original repository are not included; the studio reads artwork colors from the atlases.

| Path | Purpose |
| --- | --- |
| `index.html` | Studio interface. |
| `studio-settings.json` | Committed project defaults. |
| `assets/print/app.js` | Controls, persistence, preview, inspection, and export orchestration. |
| `assets/print/data.js` | Collection loading and source-color measurement. |
| `assets/print/render.js` | Physical sheet and mark geometry, and image centering. |
| `assets/print/palette*.js` | Source-derived palettes and hue separation. |
| `assets/print/inspection.js` | Pixel-aligned inspection crops. |
| `assets/print/separate.js` | Ink separation, screening, composite preview, and registration marks. |
| `assets/print/export.js` | PNG encoding, file names, resolution metadata, and saving. |
| `assets/print/preview-worker.js` | Preview, inspection, and export worker entry point. |
| `assets/print/motion-preview.js` | Responsive composition movement while rendering. |
| `assets/print/print.css` | Interface styles and responsive layout. |
| `vite.config.js` | Development server and static build configuration. |

## Credits and citation

*Surprise Machines* was created for the exhibition *Curatorial A(i)gents* (2022) by Dario Rodighiero, Lins Derry, Douglas Duhaime, Jordan Kruguer, Maximilian C. Mueller, Christopher Pietsch, Jeffrey T. Schnapp, Jeff Steward, and metaLAB (at) Harvard.

Rodighiero, D., Derry, L., Duhaime, D., Kruguer, J., Mueller, M. C., Pietsch, C., Schnapp, J. T., Steward, J., & metaLAB. (2022). Surprise Machines: Revealing Harvard Art Museums' image collection. *Information Design Journal*, 27(1), 21–34. [doi:10.1075/idj.22013.rod](https://doi.org/10.1075/idj.22013.rod)

Collection layouts and atlases were generated with [PixPlot](https://github.com/YaleDHLab/pix-plot), developed by the Yale Digital Humanities Lab. Palette hue separation uses Björn Ottosson’s [Oklab color space](https://bottosson.github.io/posts/oklab/).

## License

Code is distributed under the [MIT License](LICENSE). Harvard Art Museums images and metadata are not covered by the code license; see the collection notice in `LICENSE`. This project presents the collection for research and educational purposes.
