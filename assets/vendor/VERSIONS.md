# Vendored libraries (used by the original viewer, index.html)

| File | Library | Version |
|---|---|---|
| dist/three.min.js | three.js | r121 (pinned: newer releases drop the UMD build and `THREE.Geometry`, which tsne.js uses) |
| dist/trackball-controls.min.js | three.js TrackballControls | r121 (matches three.js) |
| dist/d3.min.js | d3 | 7.9.2 |
| dist/gsap.min.js | GSAP | 3.15.1 |
| dist/jszip.min.js | JSZip | 3.10.2 |
| dist/lodash.min.js | lodash | 4.18.1 |
| dist/no-ui-slider.min.js + ../css/no-ui-slider.css | noUiSlider | 15.8.1 |
| dist/papaparse.min.js | PapaParse | 5.7.0 |
| dist/stats.min.js | stats.js | 0.17.0 (latest) |
| dist/gunzip.min.js | gunzip helper | unversioned |

Files are copied from the npm packages' dist builds under the existing filenames.
