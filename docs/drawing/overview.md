# Drawing: `.draw` Format, Tools, and Export

This document is the canonical reference for Bismuth's vector drawing system: the on-disk `.draw` JSON format, the smoothing pipeline, the drawing tools and color palette, paper background options, rendering architecture, and headless PNG/PDF export. The drawing subsystem is deliberately split between a headless backend (`core/src/drawing/`) and a browser frontend (`app/src/drawing/`); all rendering primitives are pure and tested independently of the DOM.

---

## On-Disk Format

A `.draw` file is a JSON `DrawingDoc` object serialized by `serializeDoc()` (which calls `roundDoc()` before `JSON.stringify`). The file extension is `.draw`; `PaneContent` in the frontend routes `*.draw` files to `DrawingPage`.

### Top-level schema

```ts
interface DrawingDoc {
  v: 1;               // always the integer 1 (version discriminant)
  kind: "drawing";    // literal string; parseDoc checks this
  paper: Paper;       // document-wide background setting
  pages: Page[];      // one or more pages (adding pages: store.addPage())
}
```

Every field is required. `parseDoc` throws `"not a drawing document"` if `kind !== "drawing"` or `pages` is not an array.

### Paper

```ts
interface Paper {
  bg: PaperBg;   // "blank" | "lines" | "grid" | "dots"
}
```

`paper` is document-wide — all pages share the same background. Changing the background via the Toolbar updates `doc.paper.bg` via `store.setBackground()`.

### Page

```ts
interface Page {
  strokes: Stroke[];
}
```

Pages are zero-indexed. `doc.pages[0]` is always present; additional pages are appended with `store.addPage()`. Each page has its own independent stroke list; the paper background is shared.

### Stroke

```ts
interface Stroke {
  t: "pen" | "hl";   // tool: pen or highlighter
  c: string;          // color token: "fg" or explicit hex e.g. "#22C6D6"
  w: number;          // base width in drawing-space pixels (one of SIZE_LEVELS: 2,5,9,14,20)
  straight?: boolean; // optional; true = treat as a two-endpoint straight line
  pts: number[];      // flat [x, y, pressure, x, y, pressure, ...] buffer
}
```

#### `pts` buffer layout

The `pts` array is a flat triplet buffer:

```
index 0: x (drawing-space px, 0..PAGE_W)
index 1: y (drawing-space px, 0..PAGE_H)
index 2: pressure (0..255, stored as a byte)
index 3: x ...
```

- `x` and `y` are **integers** after serialization (rounded by `roundDoc`).
- `pressure` is **clamped to [0, 255]** by `roundDoc` (values outside that range are clipped). The third element of each triplet (`i % 3 === 2`) is the pressure byte; x and y are the other two. `eachPoint()` in `smooth.ts` normalizes missing pressure to 255 (full pressure).
- A single point is 3 elements. A straight stroke stores exactly two triplets (start and end) when `straight: true`.

#### Serialization rounding

`roundDoc()` rounds x/y coordinates to integers and clamps pressure to [0, 255]:

```ts
pts: s.pts.map((n, i) => (i % 3 === 2 ? clampByte(n) : Math.round(n)))
```

This means raw float coordinates from the pointer events are quantized on save. The live in-memory representation may have floats; only the written file is integer-quantized.

### Constants

```ts
const PAGE_W = 816;   // drawing canvas width in drawing-space px
const PAGE_H = 1056;  // drawing canvas height in drawing-space px
```

These match a US Letter page at 96 DPI (8.5 × 11 in). The canvas coordinate system always uses these logical dimensions regardless of display DPR or CSS size.

### Empty document

`emptyDoc()` creates the canonical starting state: version 1, grid paper, one empty page:

```ts
{ v: 1, kind: "drawing", paper: { bg: "grid" }, pages: [{ strokes: [] }] }
```

### Minimal valid `.draw` file example

```json
{
  "v": 1,
  "kind": "drawing",
  "paper": { "bg": "grid" },
  "pages": [
    {
      "strokes": [
        { "t": "pen", "c": "fg", "w": 5, "pts": [50, 50, 255, 200, 200, 200] }
      ]
    }
  ]
}
```

### Straight stroke example

```json
{ "t": "pen", "c": "#22C6D6", "w": 9, "straight": true, "pts": [100, 100, 255, 400, 300, 255] }
```

When `straight: true` the renderer uses only the first and last triplets as the two endpoints, ignoring any intermediate points. The hold-to-straighten gesture sets `straight = true` and collapses the live `pts` buffer to exactly those two endpoints.

---

## Tools

Three tools are available, controlled by the `ToolState.tool` field:

| id | description |
|----|-------------|
| `"pen"` | Freehand pen; pressure/velocity taper; stores as `Stroke { t: "pen" }` |
| `"hl"` | Highlighter; rendered at `globalAlpha = 0.32` with `globalCompositeOperation = "multiply"`; effective width is `s.w * 2` in `getStroke`; thinning forced to 0 (uniform width) |
| `"eraser"` | Stroke-eraser; not stored as a stroke type; erases the topmost stroke whose control points are within `tools.size + 8` drawing-space px of the pointer |

The eraser is a **stroke-eraser** (deletes entire strokes), not a pixel eraser.

### Tool state

```ts
interface ToolState {
  tool: "pen" | "hl" | "eraser";
  color: string;           // "fg" or hex from the palette
  size: number;            // one of SIZE_LEVELS: 2, 5, 9, 14, 20
  smoothMode: "sharp" | "smooth";
  holdToStraighten: boolean;
  holdDelayMs: number;
}
```

---

## Color Palette

The toolbar exposes a fixed 7-color palette. The first entry is `"fg"` (theme ink); the rest are explicit hex values:

| Index | Token | Hex displayed | Description |
|-------|-------|---------------|-------------|
| 0 | `"fg"` | `#E7E8F2` (swatch preview) | Theme default ink — resolves to `#1b1b1f` (light) or `#e8e8ea` (dark) at render time |
| 1 | `"#22C6D6"` | cyan | — |
| 2 | `"#5C7BEE"` | cornflower blue | — |
| 3 | `"#8B6CF0"` | violet | — |
| 4 | `"#43D49A"` | mint green | — |
| 5 | `"#F2C53D"` | amber | — |
| 6 | `"#F0509B"` | pink | — |

The color token `"fg"` is stored verbatim in `Stroke.c` and resolved at render time by `makeColorResolver(themeColors(theme))`:

```ts
// theme.ts
export function makeColorResolver(t: ThemeColors): (c: string) => string {
  return (c) => (c === "fg" ? t.fg : c);
}
```

This means a stroke drawn with the default ink color adapts to theme changes without re-saving.

### Theme colors

```ts
// light theme
{ bg: "#fbfbfa", fg: "#1b1b1f" }
// dark theme
{ bg: "#0e0e11", fg: "#e8e8ea" }
```

The `bg` color is used as the canvas fill; `fg` is what `"fg"` resolves to. Grid/line backgrounds are rendered at `rgba(fg, 0.14)`.

---

## Size Levels

Five discrete width levels (no slider):

```ts
const SIZE_LEVELS = [2, 5, 9, 14, 20];
```

`ToolState.size` must be one of these values. The value is stored directly as `Stroke.w`. For the highlighter, `getStroke` uses `s.w * 2` as the effective size.

---

## Smoothing Modes

Toggled via `ToolState.smoothMode`:

| Mode | Behavior |
|------|---------|
| `"sharp"` | The raw pointer samples are stored as-is; no post-processing on pointer-up. The stroke reflects every jitter in the input. |
| `"smooth"` | On pointer-up (`onUp()`), `smoothStrokePoints(current.pts)` is called, replacing `current.pts` before the stroke is committed to the document. The live drawing is always raw (zero lag); smoothing is applied only on release. |

A `straight` stroke (hold-to-straighten) is never smoothed regardless of `smoothMode` — it already has exactly two points.

### Hold-to-straighten gesture

When `ToolState.holdToStraighten` is true and `tool === "pen"`, holding the stylus/pointer still for `holdDelayMs` ms triggers the hold timer. If the in-progress stroke has more than 9 samples (i.e., `pts.length > 9`), the stroke is collapsed:

```ts
current.straight = true;
const x0 = current.pts[0], y0 = current.pts[1];
current.pts = [x0, y0, 255, lastRaw.x, lastRaw.y, 255];
```

The stroke then renders as a straight capsule from start to current pointer position. Moving the pointer after hold updates only the endpoint (`pts[3]`, `pts[4]`).

---

## Pressure and Velocity Width Model

### Real stylus pressure

A pointer event has "real" pressure when `pressure > 0 && pressure !== 0.5`. The value `0.5` is the browser's default for mouse events (not a real stylus reading).

```ts
export function isRealPressure(p: number): boolean { return p > 0 && p !== 0.5; }
```

When real pressure is detected at any point during the stroke (`hasReal` flag), the width model switches to the pressure formula for all subsequent samples:

```ts
// hasRealPressure path
w = base * (0.35 + 1.4 * pressure)   // pressure is the raw 0..1 PointerEvent value
```

At `pressure = 1.0`: `w = base * 1.75` (maximum). At `pressure = 0.35 / 1.4 ≈ 0.25`: `w = base * 0.7` (minimum for mid-press). The minimum approaches `base * 0.35` as pressure → 0.

### Velocity fallback (mouse / no-stylus)

When no real pressure is detected, width is derived from pointer speed:

```ts
// velocity fallback
const t = Math.min(speed / 3.2, 1);
w = base * (1.25 - 0.7 * t);
```

`speed` is computed as `(distance / dt) * 16` where distance is in drawing-space pixels and `dt` is in milliseconds. Faster movement → thinner line (calligraphic taper). At `speed = 0`: `w = base * 1.25`. At `speed ≥ 3.2`: `w = base * 0.55`.

### Pressure byte encoding

The computed width `w` is normalized against the maximum possible width (`base * 1.75`) and stored as a 0..255 byte:

```ts
const p01 = Math.max(0, Math.min(1, w / (base * 1.75)));
pressureByte = Math.round(p01 * 255);
```

On replay, `getStroke` receives `pressure / 255` to reconstruct the outline. This encoding ensures the taper is baked into the stored data and reproduces correctly at render time.

---

## Smoothing Pipeline

`smoothStrokePoints(pts, spacing?, samples?, passes?)` is the on-release post-processor. It is a four-stage pipeline, all O(n), running in sub-millisecond time on typical strokes (50–150 points):

```
1. dedupe     — drop consecutive near-duplicate points (guards spline divide-by-zero)
2. resample   — uniform arc-length resample → evenly-spaced control points
3. gaussian   — binomial [0.25, 0.5, 0.25] denoise passes (approximating — actually removes jitter)
4. catmullRom — centripetal Catmull-Rom (α = 0.5) spline interpolation → dense, flowing curve
```

### Stage 1: Dedupe

`dedupe(ps, minDist = 0.6)` drops consecutive points closer than 0.6 px. Always keeps the exact last point. Guards the downstream spline against division by zero on coincident points.

### Stage 2: Uniform resample

`resample(ps, spacing)` walks arc length and emits a point every `spacing` pixels, interpolating coordinates and pressure. Start and end points are exact. After this step all control points are equidistant, making the Gaussian kernel behave uniformly.

### Stage 3: Gaussian denoise

`gaussian(ps, passes)` applies the binomial kernel `[0.25, 0.5, 0.25]` for `passes` iterations. Endpoints are pinned (never moved). On uniformly-spaced points, a handful of passes removes hand jitter with negligible path shrinkage. Unlike an interpolating spline, this is an **approximating** pass that actually moves points away from the raw input.

Constants:
```ts
const RESAMPLE_SPACING = 9;   // px between control points after resample (full-strength)
const DENOISE_PASSES   = 12;  // Gaussian passes (full-strength)
```

### Stage 4: Catmull-Rom spline

`catmullRom(ps, samples)` emits `samples` points per segment using centripetal parameterization (α = 0.5), which is the parameterization proven to avoid cusps and self-intersections. The Barry–Goldman power-basis form is used. Phantom control points are added at both ends so the first and last segments are well-defined. The exact final input point is re-pinned to prevent floating-point drift.

```ts
const SAMPLES_PER_SEGMENT = 8;  // sub-samples per Catmull-Rom segment
```

### Scale-adaptive smoothing

`adaptiveParams(arcLen)` ramps smoothing strength based on stroke arc length to protect handwriting:

| Arc length | Spacing | Passes | Effect |
|------------|---------|--------|--------|
| < 70 px (a letter) | 2 | 1 | Minimal smoothing — mostly faithful, just de-jittered |
| 70–160 px (ramp) | 2..9 (linear) | 1..12 (linear) | Gradient between extremes |
| > 160 px (sweep) | 9 (full) | 12 (full) | Maximum smoothing |

This prevents short handwriting strokes from being "melted into illegible blobs" while long sweeping lines get full treatment. The explicit `spacing` / `passes` override parameters exist for testing and allow bypassing the adaptive logic.

### `smoothStrokePoints` signature

```ts
smoothStrokePoints(
  pts: number[],    // flat [x, y, pressure, ...] buffer
  spacing?: number, // override resample spacing (default: adaptive)
  samples?: number, // Catmull-Rom sub-samples per segment (default: 8)
  passes?: number,  // override Gaussian passes (default: adaptive)
): number[]         // new flat [x, y, pressure, ...] buffer
```

Strokes with fewer than 3 points are returned unchanged (a dot or 2-point line cannot be splined).

---

## Paper Backgrounds

`PaperBg` values and their visual meaning:

| Value | Description |
|-------|-------------|
| `"blank"` | Solid background fill, no markings |
| `"lines"` | Horizontal ruled lines at 28 px intervals |
| `"grid"` | Horizontal + vertical lines at 28 px intervals |
| `"dots"` | Dot grid at 28 px intervals (dots rendered as filled circles, radius 1.3 px) |

The gap constant:
```ts
const GRID_GAP = 28;  // px between grid/line/dot marks
```

Lines and grid marks are rendered at `rgba(fg, 0.14)` — the foreground color at 14% opacity, so they are always a low-contrast wash of the ink color.

`paperLines(bg, w, h)` returns `Line[]` structs `{x1, y1, x2, y2}` for the "lines" and "grid" modes; returns `[]` for "blank" and "dots". `paperDots(bg, w, h)` returns `Dot[]` structs `{x, y}` for the "dots" mode; returns `[]` for all others.

The default background for new drawings is `"grid"` (set by `emptyDoc()`).

---

## Rendering Architecture

### Dual-canvas model

`DrawingCanvas.tsx` uses **two stacked `<canvas>` elements**:

- **`base` canvas**: The committed layer. Repainted in full via `renderPage()` whenever the document or theme changes. Not touched during live drawing.
- **`live` canvas**: The in-progress stroke draft. Cleared and redrawn per pointer-move event via `drawStroke()`. Cleared on pointer-up after the stroke is committed.

This separation eliminates the need to repaint all committed strokes on every pointer-move event. The DPR (device pixel ratio) is capped at 2 to avoid oversized buffers on 3× displays.

### Coordinate system

The canvas backing store is always `PAGE_W * DPR × PAGE_H * DPR`. CSS sizes the canvas element responsively (100% of its container). `toLocal()` maps PointerEvent client coordinates through `getBoundingClientRect()`:

```ts
x = (e.clientX - r.left) * (PAGE_W / r.width)
y = (e.clientY - r.top)  * (PAGE_H / r.height)
```

This means strokes are stored in 816×1056 logical coordinates regardless of window size or zoom.

Zoom (`store.zoom`) scales the CSS display of the canvas; the logical coordinate system is unchanged. Zoom range is 25%–400% (`zoom <= 0.25` disables zoom-out, `zoom >= 4` disables zoom-in).

### Stroke outline rendering

`strokeOutline(s, resolveColor)` in `geometry.ts` converts a `Stroke` to a filled polygon via the `perfect-freehand` library:

- Pressure bytes are divided by 255 to restore the 0..1 pressure values that `getStroke` expects.
- `thinning`: `0` for straight strokes and highlighter, `0.6` for freehand pen (produces the pressure-driven taper).
- `smoothing`: `0.5` (a `getStroke`-internal per-vertex curve smoothing).
- `streamline`: `0` — the raw input is already smooth (either raw for "sharp", or post-processed by `smoothStrokePoints` for "smooth"). Streamline would add lag without benefit.
- `simulatePressure`: `false` — real pressure bytes are always present.
- `last: true` — caps the terminal end of the stroke.

For a straight stroke (`s.straight === true`), only the first and last points are passed to `getStroke`, producing a uniform capsule.

The polygon returned by `getStroke` is filled using `fillPolygon()` which connects polygon vertices with **quadratic curves through midpoints** (the "getSvgPathFromStroke" trick) rather than straight `lineTo` calls. This eliminates the faceted "geometric" look of straight-connected outline polygons.

### Highlighter compositing

```ts
// render2d.ts drawStroke()
ctx.globalAlpha = s.t === "hl" ? 0.32 : 1;
if (s.t === "hl") ctx.globalCompositeOperation = "multiply";
```

The highlighter renders at 32% opacity with multiply blending, matching a physical highlighter effect over text.

---

## Store and Undo/Redo

`createDrawingStore(initial, requestSave)` returns the reactive document store:

| Method | Effect |
|--------|--------|
| `commitStroke(pageIndex, stroke)` | Append stroke to page; push to undo stack; trigger save |
| `eraseStroke(pageIndex, strokeIndex)` | Remove stroke by index; push to undo stack; trigger save |
| `setBackground(bg)` | Change `paper.bg`; push to undo stack; trigger save |
| `addPage()` | Append a new empty page; push to undo stack; trigger save |
| `undo()` | Pop from undo stack, push to redo stack, trigger save |
| `redo()` | Pop from redo stack, push to undo stack, trigger save |

Undo/redo stacks hold full `DrawingDoc` snapshots (`structuredClone`). The `requestSave` callback is called on every mutation including undo/redo, using `PUT /file` (no dedicated route).

Coalesced pointer events (`e.getCoalescedEvents()`) are processed during `onMove` for smoother input capture on high-frequency stylus inputs.

---

## Headless Export

The `export.ts` module renders a `DrawingDoc` to PNG or PDF without a browser DOM, using `@napi-rs/canvas` for rasterization and `pdf-lib` for PDF assembly.

### Scale

All exports render at `SCALE = 2` (i.e., 2× logical resolution):
- PNG canvas: `PAGE_W * 2 × PAGE_H * 2` = 1632 × 2112 px per page
- PDF page dimensions: `PAGE_W × PAGE_H` = 816 × 1056 pt

### `renderDocToPng(doc, theme)`

Returns `Promise<Buffer>` — a PNG with all pages stacked vertically.

- Canvas height: `PAGE_W * 2 × (PAGE_H * n * 2)` where `n = doc.pages.length`.
- Each page is rendered at a vertical offset of `i * PAGE_H` (in logical coords, after the 2× scale transform).
- Theme: `"dark"` or `"light"` — controls background and ink color resolution.

```ts
const png = await renderDocToPng(doc, "dark");
// png is a Buffer starting with 0x89 0x50 (PNG magic bytes)
```

### `renderDocToPdf(doc, theme)`

Returns `Promise<Uint8Array>` — a multi-page PDF with one page per drawing page.

- Each page is rasterized independently at 2× resolution via `pageToPng()`.
- PNG is embedded into the PDF page via `pdf-lib`'s `embedPng()`.
- PDF pages are `PAGE_W × PAGE_H` points (816 × 1056 pt ≈ 8.5 × 11 in).
- The PDF header is `%PDF-`; page count matches `doc.pages.length`.

```ts
const pdf = await renderDocToPdf(doc, "light");
// pdf is Uint8Array; String.fromCharCode(...pdf.slice(0,5)) === "%PDF-"
```

### Theme color constants for export

| Theme | bg | fg |
|-------|----|----|
| `"light"` | `#fbfbfa` | `#1b1b1f` |
| `"dark"` | `#0e0e11` | `#e8e8ea` |

---

## Toolbar Layout

The drawing toolbar (`Toolbar.tsx`) is organized as a two-row horizontal dock with four groups:

1. **Tools** (pen / highlighter / eraser) — `SegmentedToggle` with Lucide icons
2. **Colors + Sizes** — stacked vertically: 7 color swatches (top row), 5 size dots (bottom row); same bounding box so the rows align
3. **Smoothing + Paper** — stacked vertically: sharp/smooth toggle (top), paper background selector (bottom)
4. **Undo/Redo + Zoom** — stacked vertically: undo + redo buttons (top), zoom-out / percentage / zoom-in (bottom)

The paper options cycle through `["blank", "lines", "grid", "dots"]` in that order.

---

## Persistence

`.draw` files are read and written via the generic `PUT /file` endpoint — there is no dedicated drawing API route. The frontend:

1. Reads the file content via `api.read(path)` → `parseDoc(text)`.
2. On each mutation (stroke commit, erase, background change, undo/redo), calls `serializeDoc(doc)` and `api.write(path, text)` via `PUT /file`.

Saves are triggered immediately on every mutation (no debounce), since `DrawingCanvas` coalesces pointer events and only commits on pointer-up.

---

## Edge Cases and Gotchas

- **Two separate "fewer than 3" guards (don't conflate them)**: these count different things.
  - *Flat-array element count (`eachPoint`)*: `pts` is a flat `number[]` of `(x, y, pressure)` triples. `eachPoint` iterates in steps of 3 with the guard `i + 2 < a.length + 1`, emitting one point per **complete** triple — so an array with fewer than 3 elements yields zero points, and exactly 3 elements yields one valid point.
  - *Point count (`smoothStrokePoints`)*: after `toPts`/`dedupe`, smoothing operates on **points**. `smoothStrokePoints` returns the buffer unchanged when there are `< 3` points (a single dot or a 2-point line has nothing to smooth) — this is a point-count threshold, not the element-count one above.
- **Pressure out of [0, 255]**: `roundDoc` clamps via `clampByte`; values like 300 or -5 become 255/0 on disk. The live buffer may temporarily hold out-of-range values before serialization.
- **`"fg"` stored literally**: color `"fg"` is written to disk as the string `"fg"`, not the resolved hex. Theme changes after the fact automatically produce the correct color.
- **Coincident points crash prevention**: `dedupe` drops near-coincident points (< 0.6 px apart) before the spline stage. Without this, zero-length segments cause division-by-zero in the Catmull-Rom knot computation.
- **Straight stroke rendering**: When `straight: true`, `strokeOutline` passes only `[input[0], input[input.length - 1]]` to `getStroke`. Any intermediate points in `pts` are ignored at render time.
- **Highlighter on dark themes**: Multiply blending at 0.32 alpha works well over light backgrounds but may produce unexpected results on dark backgrounds. The highlighter width is also 2× the stored `w` value.
- **`streamline: 0` rationale**: The `getStroke` `streamline` parameter applies a trailing exponential moving average to the input, which introduces display lag proportional to its value. Since the live path is raw (no smoothing), and the committed path is already preprocessed by `smoothStrokePoints`, `streamline` is set to 0 to avoid any lag.
- **Page dimensions are fixed**: `PAGE_W = 816` and `PAGE_H = 1056` are compile-time constants. There is no per-document or per-page size setting.
- **DPR cap**: `DrawingCanvas` caps DPR at 2 (`Math.min(window.devicePixelRatio || 1, 2)`) to prevent excessively large canvas buffers on 3× displays.
- **Export uses theme colors, not CSS vars**: The headless export cannot read CSS custom properties. It uses the hardcoded `themeColors()` function from `theme.ts`. Pass the correct theme (`"dark"` or `"light"`) to get the right background and ink color.

Source: `core/src/drawing/model.ts`, `core/src/drawing/geometry.ts`, `core/src/drawing/smooth.ts`, `core/src/drawing/paper.ts`, `core/src/drawing/theme.ts`, `core/src/drawing/export.ts`, `core/src/drawing/render2d.ts`, `app/src/drawing/Toolbar.tsx`, `app/src/drawing/DrawingCanvas.tsx`, `app/src/drawing/input.ts`, `app/src/drawing/store.ts`, `core/test/drawing/model.test.ts`, `core/test/drawing/smooth.test.ts`, `core/test/drawing/geometry.test.ts`, `core/test/drawing/export.test.ts`
