<p align="center">
  <img src="public/favicon.svg" width="72" alt="Pixprite logo">
</p>

<h1 align="center">Pixprite</h1>

<p align="center">
  Pixel art and animation editor that runs in the browser.<br>
  <a href="https://vicimpa.github.io/pixprite/"><b>Open the editor</b></a> · <a href="README.ru.md">Русский</a>
</p>

> **Status:** early development (v0.0.1). Things change fast and may break.

## Features

- **Drawing** — pencil, eraser, spray, lines, curves, shapes, contour/polygon fill, bucket fill with tolerance, gradients with dithering, text, blur and scatter. Pattern painting, pixel-perfect strokes, stabilizer, symmetry, custom brushes, brush library and tool presets, pen pressure.
- **Selection** — rectangle, ellipse, lasso, polygon, magic wand, by color, by layer opacity; add/subtract/intersect; move, scale, rotate and skew with precise input.
- **Layers** — groups, tilemap layers, reference images, clipping to the layer below, blend modes, opacity, solo visibility, merging that keeps the visible result.
- **Animation** — frames with durations, tags with direction and repeat count, linked cels, onion skin, in-between frame generation, bulk timing, preview window.
- **Color** — RGB, grayscale and indexed modes; palette ramps (RGB/HSV/OKLab), sorting and cleanup, color quantization, per-frame palettes.
- **Tilemaps** — tilesets with flips and rotation, duplicate detection, usage counts, tileset import/export, map export to JSON/CSV.
- **Files** — native `.pixprite` projects with autosave and snapshots, `.aseprite` read/write, PNG, GIF, APNG, WebM, ICO/CUR, sprite sheets with JSON metadata, ZIP exports.
- **Workspace** — command palette, rebindable hotkeys, document tabs, rulers and guides with snapping, touch and trackpad gestures, light and dark themes, i18n.

All projects are stored locally in your browser (IndexedDB). Nothing is uploaded anywhere.

## Development

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev        # dev server on http://localhost:3355
bun run typecheck  # tsc -b
bun run build      # production build into dist/
```

### Project layout

```
src/
  core/      editor model: sprite, tools, commands, file formats, workers
  modules/   app UI blocks: editor view, timeline, panels, dialogs, menus
  ui/        reusable UI components
  styles/    global styles and theme variables
public/      static assets (icons)
```

Imports use the `~/` alias for `src/`, e.g. `import { state } from "~/core/State"`.

Pushes to `main` are built and deployed to GitHub Pages by CI.

## Clean-room policy

Pixprite is an independent project. It is inspired by the general feature set of existing pixel-art editors, but no code, algorithms, assets, icons or texts are copied from them. File formats such as `.aseprite` are implemented from their public specifications. Please keep contributions to the same rule.

## License

[MIT](LICENSE)
