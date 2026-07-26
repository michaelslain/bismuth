// app/src/graph/asciiGrid.ts
//
// The pure half of the ASCII knowledge graph: everything about the CHARACTER GRID that can be
// computed without a DOM. AsciiGraphRenderer.ts owns the canvas, the camera and the rAF loop; this
// file owns the arithmetic — grid sizing, world→cell mapping, the degree/depth glyph ramp, the
// Bresenham edge trace with "+" junctions, and the cell→node hit test. All of it is unit-tested
// (asciiGrid.test.ts).
//
// Sources: design/ascii/design-system/tokens/ascii.css (cell metrics + glyph vocabulary),
// design/ascii/design-system/guidelines/ascii-graph.card.html (the field), ascii-zoom.card.html
// (THE LAW: zoom is resolution — the cell never changes size, the grid subdivides), and
// design/ascii/PORTING.md §4.

/** Cell metrics at --fs-ui (11.5px Monaspace Xenon) — asciiGraph.css --cell-w / --cell-h. CELL_W is
 *  the font's own advance width at that size; CELL_H is the app's unified row unit (--row-h, owned
 *  by ui/ui.css — same rhythm the sidebar tree/tabs/tables use), NOT derived from the font metric.
 *  Both the main field and the sidebar mini-graph draw on this one cell — there is no denser variant
 *  any more (killed with setDense; see AsciiGraphRenderer). Fallbacks only: the renderer reads the
 *  live --cell-h/--row-h off the host at runtime, these are just the pre-mount / test defaults. */
export const CELL_W = 6.3;
export const CELL_H = 18;
/** Font size that goes WITH the cell pair above. Change one, change the other, or the drawing shears. */
export const FONT_PX = 11.5;

/** The field's inset, matching the reference card (GraphField.tsx uses the same numbers). */
export const PAD_X = 8;
export const PAD_Y = 10;

/** Node degree ramp — a node's weight is its GLYPH, never its size (tokens/ascii.css). */
export const NODE_GLYPHS = [".", "o", "@"] as const;

/** Layer priority in the cell buffer. A higher layer overwrites a lower one, which is how the
 *  noise field gets CLEARED beneath every edge and node ("or the field reads as mush"). */
export const LAYER_EMPTY = 0;
export const LAYER_NOISE = 1;
export const LAYER_EDGE = 2;
export const LAYER_NODE = 3;

export interface GridMetrics {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  padX: number;
  padY: number;
}

/** Size the character grid for a box of `w`×`h` CSS px. Never returns a zero dimension — a
 *  degenerate (mid-layout) box yields a 1×1 grid rather than an empty buffer. */
export function gridMetrics(w: number, h: number, cellW: number, cellH: number, padX = PAD_X, padY = PAD_Y): GridMetrics {
  const cols = Math.max(1, Math.floor((w - padX * 2) / cellW));
  const rows = Math.max(1, Math.floor((h - padY * 2) / cellH));
  return { cols, rows, cellW, cellH, padX, padY };
}

/** Top-left px of a cell, relative to the field's own top-left corner. */
export function cellToPx(col: number, row: number, m: GridMetrics): { x: number; y: number } {
  return { x: m.padX + col * m.cellW, y: m.padY + row * m.cellH };
}

/** The cell a px point (relative to the field's top-left) falls in. Can return out-of-range
 *  indices — callers clamp or reject; wrapping would silently teleport a hit across the field. */
export function pxToCell(x: number, y: number, m: GridMetrics): { col: number; row: number } {
  return { col: Math.floor((x - m.padX) / m.cellW), row: Math.floor((y - m.padY) / m.cellH) };
}

/** Snap a projected screen px position (relative to the field's top-left) onto the nearest cell
 *  CENTRE. This is the whole of "zoom is resolution": the caller scales world→px by the current
 *  resolution, and the grid it lands on always has the same cell size. */
export function snapToCell(x: number, y: number, m: GridMetrics): { col: number; row: number } {
  return { col: Math.round((x - m.padX) / m.cellW), row: Math.round((y - m.padY) / m.cellH) };
}

export function inGrid(col: number, row: number, m: GridMetrics): boolean {
  return col >= 0 && col < m.cols && row >= 0 && row < m.rows;
}

/** Degree tier: 0 = "." leaf, 1 = "o" linked, 2 = "@" hub (ascii-graph.card.html). */
export function degreeTier(deg: number): number {
  return deg >= 5 ? 2 : deg >= 2 ? 1 : 0;
}

/** Bucket a 0..1 depth rank (0 = farthest from the camera, 1 = nearest) into `bands` bands. */
export function depthBand(dr: number, bands = 3): number {
  if (!Number.isFinite(dr)) return bands - 1;
  const b = Math.floor(dr * bands);
  return b < 0 ? 0 : b >= bands ? bands - 1 : b;
}

/**
 * The 3D depth cue: shift the DEGREE RAMP by depth band, never the font size. A near hub reads
 * "@", the same hub in the back plane drops to "o" and then "."; a near leaf is promoted to "o".
 * `is3d === false` returns the flat degree tier untouched (2D has no depth to encode).
 */
export function glyphTier(deg: number, dr: number, is3d: boolean, bands = 3): number {
  const base = degreeTier(deg);
  if (!is3d) return base;
  const shifted = base + (depthBand(dr, bands) - Math.floor(bands / 2));
  return shifted < 0 ? 0 : shifted > 2 ? 2 : shifted;
}

export function nodeGlyph(deg: number, dr: number, is3d: boolean, bands = 3): string {
  return NODE_GLYPHS[glyphTier(deg, dr, is3d, bands)];
}

/** Per-band alpha for the 3D depth fade (near = opaque, far = faint). */
export function depthAlpha(dr: number, min = 0.22, curve = 1.8): number {
  if (!Number.isFinite(dr)) return 1;
  const t = dr < 0 ? 0 : dr > 1 ? 1 : dr;
  return min + (1 - min) * Math.pow(t, curve);
}

const EDGE_CHARS = new Set(["-", "|", "/", "\\", "+"]);

/**
 * Merge an incoming edge glyph with whatever an edge already drew in that cell: two edges of
 * DIFFERENT orientation crossing produce a "+" junction; the same glyph twice stays itself.
 * `existing` that isn't an edge glyph (empty, or a noise character) is simply replaced — which is
 * how the edge layer clears the noise beneath it.
 */
export function mergeEdgeChar(existing: string, incoming: string): string {
  if (!existing || !EDGE_CHARS.has(existing)) return incoming;
  if (existing === incoming) return existing;
  return "+";
}

/** Char CODES for the edge vocabulary, so the renderer's hot loop can merge junctions without
 *  allocating a string per cell (600k+ of them a frame at 2.6k edges). */
export const CODE_PLUS = 43;  // "+"

/**
 * mergeEdgeChar at the char-CODE level: `prevWasEdge` says whether the cell currently holds an
 * edge glyph (anything else — empty, or a noise character — is simply overwritten, which is how
 * the edge layer clears the noise). Allocation-free; asciiGrid.test.ts pins it to mergeEdgeChar.
 */
export function mergeEdgeCode(prevCode: number, incomingCode: number, prevWasEdge: boolean): number {
  if (!prevWasEdge) return incomingCode;
  return prevCode === incomingCode ? prevCode : CODE_PLUS;
}

/**
 * Bresenham-trace the segment (x0,y0)→(x1,y1) across the grid, calling `put` for every stepped
 * cell with the run glyph: "-" horizontal, "|" vertical, "/" or "\" diagonal (by the sign
 * relationship of the two axis steps). The endpoints themselves are NOT emitted — the node layer
 * owns those cells. Allocation-free (the caller supplies the sink), so it is safe in the per-frame
 * hot loop. Guarded so a pathological pair can't spin.
 *
 * Same algorithm as ui/ascii/rasterEdges.ts, restated against a callback instead of a string grid
 * so the renderer can write straight into its typed-array buffers.
 */
export function traceEdge(
  x0: number, y0: number, x1: number, y1: number,
  put: (x: number, y: number, ch: string) => void,
  guardMax = 4000,
): void {
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  while (guard++ < guardMax && !(x === x1 && y === y1)) {
    const e2 = 2 * err;
    let mx = false, my = false;
    if (e2 > -dy) { err -= dy; x += sx; mx = true; }
    if (e2 < dx) { err += dx; y += sy; my = true; }
    if (x === x1 && y === y1) break; // the far endpoint belongs to the node layer
    put(x, y, mx && my ? (sx === sy ? "\\" : "/") : mx ? "-" : "|");
  }
}

/**
 * Nearest node to a cell, searching outward in square rings up to `radius` cells. `cellNode` is a
 * cols*rows Int32Array of node indices (-1 = no node), rebuilt on every rasterization. Returns -1
 * when nothing is within the radius. Rings mean the closest hit wins, so a dense field doesn't
 * pick a node several cells away when one sits under the cursor.
 */
export function nearestCellNode(col: number, row: number, m: GridMetrics, cellNode: Int32Array, radius = 2): number {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (r > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only
        const c = col + dx, rw = row + dy;
        if (!inGrid(c, rw, m)) continue;
        const idx = cellNode[rw * m.cols + c];
        if (idx >= 0) return idx;
      }
    }
  }
  return -1;
}

/**
 * Resolution → the world-units-per-cell ratio, expressed as the px-per-world-unit scale the
 * projection multiplies by. At `res = 1` the whole graph fits the grid (0% zoom); at `res = max`
 * the field is at maximum resolution with every note named (100%). The CELL SIZE is not a term in
 * this function — that is the point.
 */
export function fitPxPerWorld(cols: number, rows: number, m: GridMetrics, radius: number, fitFraction = 0.42): number {
  const boxPx = Math.min(cols * m.cellW, rows * m.cellH);
  return (boxPx * fitFraction) / Math.max(1e-6, radius);
}

/** Resolution multiplier → the continuous 0..1 log-scale progress toward `maxRes` that both the
 *  0–100% readout (`resolutionPercent`) and the label crossfade math (`labelSelection.ts`
 *  `fileLabelBudget`/`fileLabelAlpha`) key off. Unrounded, unlike the percent readout, so the
 *  crossfade stays smooth frame to frame instead of stepping in 1% jumps. */
export function resolutionT(res: number, maxRes: number): number {
  if (maxRes <= 1) return 0;
  const t = Math.log(Math.max(1, res)) / Math.log(maxRes);
  return Math.max(0, Math.min(1, t));
}

/** Map a resolution multiplier onto the 0–100 readout the design's viewbar shows. */
export function resolutionPercent(res: number, maxRes: number): number {
  return Math.round(resolutionT(res, maxRes) * 100);
}
