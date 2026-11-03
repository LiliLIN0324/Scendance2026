# Material Symbols attribution

The product UI uses a locally subsetted Material Symbols Rounded variable font from `@fontsource-variable/material-symbols-rounded` 5.3.8. The font retains FILL, GRAD, optical size, and weight axes; the app sets FILL 1, weight 300, grade 0, and optical size to the rendered size. Font license: SIL Open Font License 1.1, included at `frontend/public/fonts/MATERIAL-SYMBOLS-OFL.txt`.

The `rounded/` SVG source set comes from `@material-symbols/svg-400` 0.48.2 (Apache 2.0); see `LICENSE`. Selected lighter-looking glyphs use their official `*-fill.svg` versions at 400 weight, referenced by `frontend/components/room-organizer/panels/material-symbol.tsx` and tinted with `currentColor`.

Upstream: https://github.com/google/material-design-icons
Fontsource package: https://www.npmjs.com/package/@fontsource-variable/material-symbols-rounded
