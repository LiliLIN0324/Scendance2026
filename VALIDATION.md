# 3DAssets integration verification — 2026-10-02

- Five official GLB downloads validated against byte counts, glTF scene structure, buffers, bounds and SHA-256 records in `assets/catalogue.json`.
- Direct GLTFLoader parsing and instancing check: 25 team tables, 100 participant chairs and 100 schematic seated/standing participants; service furniture is additional.
- All local Three.js relative import dependencies resolve. Official three@0.186.1 npm archive SHA-512 matched registry metadata.
- Browser loaded all five models in the actual venue, showing `ready` and `5/5`; a fresh final preview had no console errors.
- Individual 3D preview successfully loaded table, chair, laptop, plant and speaker.
- Browser verified overview and top views, functional-zone selection, mentor and demo phases, range ending at T+48:00, playback restart, and paused time remaining unchanged at T+26:24.
- A drag performed inside the visible canvas changed the viewpoint while preserving the selected mentor zone. A first drag attempt used unsuitable viewport coordinates and is not counted as a successful selection test.
- Explicit camera presets now flush previous drag inertia before applying new coordinates; final scene reset was visually inspected.
- Responsive browser check at 390×844: document width 390, no horizontal overflow, visible canvas and controls. Desktop and mobile screenshots retained as `preview-webgl-desktop.jpg` and `preview-webgl-mobile.jpg`.

This is a concept-scale 3D venue with imported prop assets. It is not a measured reconstruction of the photographed gym. Validation used the current desktop browser and mobile viewport emulation; no physical-phone performance claim is made.
