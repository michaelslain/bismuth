// app/src/graph/asciiGrid.test.ts
// The pure half of the ASCII graph: grid mapping, the degree/depth glyph ramp, the Bresenham edge
// trace with "+" junctions, and the cell hit test. The 3D camera math itself is copied verbatim
// from CanvasGraphRenderer and already proven, so it isn't re-tested here.
import { describe, expect, it } from "bun:test";
import {
  CELL_H, CELL_W, COMPACT_FLOOR_SCALE, COMPACT_MAX_DIM, COMPACT_MIN_DIM, DEEPEST_WORLD_PER_CELL,
  MIN_ZOOM_SPAN, NODE_GLYPHS, PAD_X, PAD_Y, ZOOM_STEP_PCT,
  cellToPx, clipSegmentToGrid, compactScale, degreeTier, depthAlpha, depthBand, fitPxPerWorld,
  glyphTier, gridMetrics, inGrid, maxResFor, mergeEdgeChar, mergeEdgeCode, nearestCellNode,
  nodeGlyph, pxToCell, quantizePan, resFromPercent, resFromT, resolutionPercent, resolutionT,
  snapToCell, snapZoomPercent, traceEdge,
} from "./asciiGrid";

describe("gridMetrics", () => {
  it("sizes the grid from the box, minus the field padding", () => {
    const m = gridMetrics(1000, 600, CELL_W, CELL_H, PAD_X, PAD_Y);
    expect(m.cols).toBe(Math.floor((1000 - 16) / CELL_W));
    expect(m.rows).toBe(Math.floor((600 - 20) / CELL_H));
  });

  it("never returns a zero dimension for a degenerate mid-layout box", () => {
    const m = gridMetrics(0, 0, CELL_W, CELL_H);
    expect(m.cols).toBe(1);
    expect(m.rows).toBe(1);
  });

  it("keeps the cell size CONSTANT as the box grows — only the cell COUNT changes (the zoom law)", () => {
    const small = gridMetrics(400, 400, CELL_W, CELL_H);
    const big = gridMetrics(800, 800, CELL_W, CELL_H);
    expect(big.cellW).toBe(small.cellW);
    expect(big.cellH).toBe(small.cellH);
    expect(big.cols).toBeGreaterThan(small.cols);
  });
});

describe("cell <-> px mapping", () => {
  const m = gridMetrics(500, 300, CELL_W, CELL_H);

  it("round-trips a cell through px and back", () => {
    for (const [col, row] of [[0, 0], [3, 7], [m.cols - 1, m.rows - 1]] as const) {
      const p = cellToPx(col, row, m);
      expect(pxToCell(p.x + 0.1, p.y + 0.1, m)).toEqual({ col, row });
    }
  });

  it("snapToCell rounds to the NEAREST cell (projected points land between cells)", () => {
    const p = cellToPx(5, 5, m);
    expect(snapToCell(p.x + m.cellW * 0.49, p.y, m).col).toBe(5);
    expect(snapToCell(p.x + m.cellW * 0.51, p.y, m).col).toBe(6);
  });

  it("matches the arithmetic the renderer inlines in its per-frame projection loop", () => {
    const x = 123.4, y = 77.7;
    expect(snapToCell(x, y, m)).toEqual({
      col: Math.round((x - m.padX) / m.cellW),
      row: Math.round((y - m.padY) / m.cellH),
    });
  });

  it("reports out-of-range cells rather than wrapping them", () => {
    expect(inGrid(-1, 0, m)).toBe(false);
    expect(inGrid(m.cols, 0, m)).toBe(false);
    expect(inGrid(0, m.rows, m)).toBe(false);
    expect(inGrid(0, 0, m)).toBe(true);
  });
});

describe("degree ramp", () => {
  it("maps degree onto . / o / @", () => {
    expect(NODE_GLYPHS[degreeTier(0)]).toBe(".");
    expect(NODE_GLYPHS[degreeTier(1)]).toBe(".");
    expect(NODE_GLYPHS[degreeTier(2)]).toBe("o");
    expect(NODE_GLYPHS[degreeTier(4)]).toBe("o");
    expect(NODE_GLYPHS[degreeTier(5)]).toBe("@");
    expect(NODE_GLYPHS[degreeTier(90)]).toBe("@");
  });

  it("leaves the ramp alone in 2D, whatever the depth rank says", () => {
    expect(nodeGlyph(0, 0, false)).toBe(".");
    expect(nodeGlyph(0, 1, false)).toBe(".");
    expect(nodeGlyph(7, 0, false)).toBe("@");
  });
});

describe("depth banding (the 3D cue is the GLYPH, never the font)", () => {
  it("buckets a 0..1 depth rank", () => {
    expect(depthBand(0)).toBe(0);
    expect(depthBand(0.5)).toBe(1);
    expect(depthBand(0.99)).toBe(2);
    expect(depthBand(1)).toBe(2);      // the top edge stays in the last band
    expect(depthBand(NaN)).toBe(2);
  });

  it("promotes a near node and demotes a far one by one ramp step", () => {
    expect(glyphTier(2, 1, true)).toBe(2);   // "o" in the near band reads as a hub
    expect(glyphTier(2, 0.5, true)).toBe(1); // mid band = the plain degree tier
    expect(glyphTier(2, 0, true)).toBe(0);   // far band drops to a leaf dot
  });

  it("clamps at both ends of the ramp", () => {
    expect(glyphTier(0, 0, true)).toBe(0);
    expect(glyphTier(50, 1, true)).toBe(2);
  });

  it("fades alpha with depth, monotonically, never below the floor", () => {
    expect(depthAlpha(0)).toBeCloseTo(0.22, 5);
    expect(depthAlpha(1)).toBeCloseTo(1, 5);
    expect(depthAlpha(0.5)).toBeGreaterThan(depthAlpha(0.2));
    expect(depthAlpha(-5)).toBeCloseTo(0.22, 5);
    expect(depthAlpha(5)).toBeCloseTo(1, 5);
  });
});

describe("mergeEdgeChar", () => {
  it("replaces anything that isn't an edge glyph (this is how noise is cleared)", () => {
    expect(mergeEdgeChar("", "-")).toBe("-");
    expect(mergeEdgeChar("#", "|")).toBe("|");
    expect(mergeEdgeChar(" ", "/")).toBe("/");
  });

  it("keeps the glyph when the same run passes twice", () => {
    expect(mergeEdgeChar("-", "-")).toBe("-");
    expect(mergeEdgeChar("\\", "\\")).toBe("\\");
  });

  it("turns crossing runs into a + junction", () => {
    expect(mergeEdgeChar("-", "|")).toBe("+");
    expect(mergeEdgeChar("/", "\\")).toBe("+");
    expect(mergeEdgeChar("+", "-")).toBe("+");
  });

  it("mergeEdgeCode (the renderer's allocation-free path) agrees with it, cell for cell", () => {
    const glyphs = ["-", "|", "/", "\\", "+"];
    for (const prev of glyphs) {
      for (const next of glyphs) {
        expect(String.fromCharCode(mergeEdgeCode(prev.charCodeAt(0), next.charCodeAt(0), true)))
          .toBe(mergeEdgeChar(prev, next));
      }
    }
    // A non-edge cell (empty / a noise glyph) is overwritten, never merged.
    for (const next of glyphs) {
      expect(String.fromCharCode(mergeEdgeCode("#".charCodeAt(0), next.charCodeAt(0), false))).toBe(next);
      expect(String.fromCharCode(mergeEdgeCode(0, next.charCodeAt(0), false))).toBe(next);
    }
  });
});

describe("traceEdge", () => {
  const trace = (x0: number, y0: number, x1: number, y1: number) => {
    const out: { x: number; y: number; ch: string }[] = [];
    traceEdge(x0, y0, x1, y1, (x, y, ch) => out.push({ x, y, ch }));
    return out;
  };

  it("draws a horizontal run with '-' and excludes both endpoints", () => {
    const cells = trace(0, 3, 5, 3);
    expect(cells.map((c) => c.ch).join("")).toBe("----");
    expect(cells[0]).toEqual({ x: 1, y: 3, ch: "-" });
    expect(cells.at(-1)).toEqual({ x: 4, y: 3, ch: "-" });
  });

  it("draws a vertical run with '|'", () => {
    expect(trace(2, 0, 2, 4).every((c) => c.ch === "|" && c.x === 2)).toBe(true);
  });

  it("picks the diagonal glyph by the sign relationship of the two steps", () => {
    expect(trace(0, 0, 4, 4).every((c) => c.ch === "\\")).toBe(true); // down-right
    expect(trace(0, 4, 4, 0).every((c) => c.ch === "/")).toBe(true);  // up-right
  });

  it("emits nothing for a zero-length edge", () => {
    expect(trace(3, 3, 3, 3)).toEqual([]);
  });

  it("terminates on a pathological pair instead of spinning", () => {
    const out: unknown[] = [];
    traceEdge(0, 0, 1e9, 1, () => out.push(1), 50);
    expect(out.length).toBeLessThanOrEqual(50);
  });
});

describe("clipSegmentToGrid (the 'edges vanish at deep zoom' fix)", () => {
  const m = gridMetrics(200, 200, CELL_W, CELL_H); // some cols x rows rectangle, cell-index space

  it("leaves a segment already fully inside the grid unchanged", () => {
    const clipped = clipSegmentToGrid(2, 3, m.cols - 3, m.rows - 3, m);
    expect(clipped).toEqual({ x0: 2, y0: 3, x1: m.cols - 3, y1: m.rows - 3 });
  });

  it("clips a segment with ONE endpoint far off-grid down to the on-screen portion", () => {
    // Far endpoint sits way past the right edge — the old rule ("skip unless BOTH endpoints are
    // on-grid") dropped this edge entirely; the fix draws its visible portion instead.
    const clipped = clipSegmentToGrid(0, Math.floor(m.rows / 2), m.cols * 50, Math.floor(m.rows / 2), m);
    expect(clipped).not.toBeNull();
    expect(clipped!.x0).toBe(0);
    expect(clipped!.x1).toBe(m.cols - 1);
    expect(clipped!.y0).toBe(Math.floor(m.rows / 2));
    expect(clipped!.y1).toBe(Math.floor(m.rows / 2));
  });

  it("clips a segment with BOTH endpoints off-grid but crossing straight through it", () => {
    const row = Math.floor(m.rows / 2);
    const clipped = clipSegmentToGrid(-1000, row, m.cols + 1000, row, m);
    expect(clipped).not.toBeNull();
    expect(clipped!.x0).toBe(0);
    expect(clipped!.x1).toBe(m.cols - 1);
  });

  it("returns null for a segment that never crosses the grid at all", () => {
    // Both endpoints are past the right edge, moving further right — never touches the rectangle.
    expect(clipSegmentToGrid(m.cols + 10, 0, m.cols + 20, m.rows - 1, m)).toBeNull();
    // Same idea, entirely above the top edge.
    expect(clipSegmentToGrid(0, -50, m.cols - 1, -20, m)).toBeNull();
  });

  it("a clipped segment always lands inside the grid's cell-index bounds", () => {
    const cases: [number, number, number, number][] = [
      [-500, -500, 500, 500], [1000, 5, -1000, 5], [5, -1000, 5, 1000], [-1000, 1000, 1000, -1000],
    ];
    for (const [x0, y0, x1, y1] of cases) {
      const c = clipSegmentToGrid(x0, y0, x1, y1, m);
      if (!c) continue;
      for (const [x, y] of [[c.x0, c.y0], [c.x1, c.y1]] as const) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(m.cols - 1);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(m.rows - 1);
      }
    }
  });
});

describe("quantizePan (the pan-jitter fix)", () => {
  it("a pan of exactly zero quantizes to zero, no residual", () => {
    expect(quantizePan(0, CELL_W)).toEqual({ whole: 0, frac: 0 });
  });

  it("an exact whole-cell multiple has no residual", () => {
    expect(quantizePan(CELL_W * 4, CELL_W)).toEqual({ whole: CELL_W * 4, frac: 0 });
    expect(quantizePan(-CELL_W * 3, CELL_W)).toEqual({ whole: -CELL_W * 3, frac: 0 });
  });

  it("splits a sub-cell pan into the nearest whole cell + a small residual", () => {
    const { whole, frac } = quantizePan(CELL_W * 2 + CELL_W * 0.3, CELL_W);
    expect(whole).toBeCloseTo(CELL_W * 2, 6);
    expect(frac).toBeCloseTo(CELL_W * 0.3, 6);
  });

  it("whole + frac always reconstructs the original pan exactly", () => {
    for (const pan of [0, 1.3, -1.3, 47.8, -999.25, CELL_W * 10.7]) {
      const { whole, frac } = quantizePan(pan, CELL_W);
      expect(whole + frac).toBeCloseTo(pan, 9);
    }
  });

  it("the whole part is always an exact multiple of the cell size (the phase never shifts)", () => {
    for (const pan of [3, -3, 0.1, 100.9, -250.4]) {
      const { whole } = quantizePan(pan, CELL_W);
      expect(Math.round(whole / CELL_W)).toBeCloseTo(whole / CELL_W, 9);
    }
  });

  it("degrades to a no-op residual on a non-finite pan or a degenerate cell size", () => {
    expect(quantizePan(NaN, CELL_W)).toEqual({ whole: 0, frac: 0 });
    expect(quantizePan(5, 0)).toEqual({ whole: 0, frac: 0 });
  });
});

describe("nearestCellNode (the hit test)", () => {
  const m = gridMetrics(200, 200, CELL_W, CELL_H);
  const buf = () => new Int32Array(m.cols * m.rows).fill(-1);

  it("finds a node under the cursor's own cell", () => {
    const b = buf();
    b[4 * m.cols + 6] = 42;
    expect(nearestCellNode(6, 4, m, b)).toBe(42);
  });

  it("finds a node a cell or two away (a generous target on a small glyph)", () => {
    const b = buf();
    b[4 * m.cols + 6] = 7;
    expect(nearestCellNode(8, 4, m, b, 2)).toBe(7);
    expect(nearestCellNode(9, 4, m, b, 2)).toBe(-1);
  });

  it("prefers the closer node when two are in range", () => {
    const b = buf();
    b[4 * m.cols + 6] = 1; // 2 cells away
    b[4 * m.cols + 5] = 2; // 1 cell away
    expect(nearestCellNode(4, 4, m, b, 2)).toBe(2);
  });

  it("returns -1 outside the grid rather than wrapping", () => {
    const b = buf();
    b[0] = 9;
    expect(nearestCellNode(-5, -5, m, b, 1)).toBe(-1);
  });
});

describe("zoom is resolution", () => {
  const m = gridMetrics(700, 500, CELL_W, CELL_H);

  it("fits the whole graph at res = 1 (the px scale shrinks as the graph grows)", () => {
    const a = fitPxPerWorld(m.cols, m.rows, m, 100);
    const b = fitPxPerWorld(m.cols, m.rows, m, 200);
    expect(b).toBeCloseTo(a / 2, 6);
  });

  it("never divides by a zero-radius (degenerate) layout", () => {
    expect(Number.isFinite(fitPxPerWorld(m.cols, m.rows, m, 0))).toBe(true);
  });

  it("reports 100% at fit and 0% at maximum resolution (the HUD convention: 100=fit, 0=deepest)", () => {
    expect(resolutionPercent(1, 16)).toBe(100);
    expect(resolutionPercent(16, 16)).toBe(0);
    expect(resolutionPercent(4, 16)).toBe(50);
    expect(resolutionPercent(0.1, 16)).toBe(100); // clamped — you cannot zoom out past fit
  });

  it("resolutionT stays in the ORIGINAL 0=fit/1=deepest direction internally — only the HUD percent is inverted", () => {
    expect(resolutionT(1, 16)).toBe(0);
    expect(resolutionT(16, 16)).toBe(1);
    expect(resolutionT(4, 16)).toBeCloseTo(0.5, 10);
    expect(resolutionT(0.1, 16)).toBe(0); // clamped, same as resolutionPercent
    for (const res of [1, 2, 4, 7, 10, 16]) {
      expect(Math.round((1 - resolutionT(res, 16)) * 100)).toBe(resolutionPercent(res, 16));
    }
  });
});

describe("maxResFor — the fixed absolute 0% ceiling", () => {
  /** The ladder must never collapse onto fit. A graph already denser at fit than the absolute
   *  target (any graph, once the field is big enough — see MIN_ZOOM_SPAN) used to floor at exactly
   *  1, and `maxRes <= 1` degenerates BOTH percent mappings: every step maps to res 1, every res
   *  maps to 100%. The wheel became a dead control with a HUD frozen at "100%". */
  it("never collapses the ladder: a graph already denser than the absolute target still spans MIN_ZOOM_SPAN", () => {
    expect(maxResFor(1000, CELL_W)).toBe(MIN_ZOOM_SPAN);
    expect(MIN_ZOOM_SPAN).toBeGreaterThan(1);
  });

  it("every stop is a DISTINCT resolution, even at the floor (the collapse regression)", () => {
    const maxRes = maxResFor(1000, CELL_W);
    const stops = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0].map((p) => resFromPercent(p, maxRes));
    expect(new Set(stops).size).toBe(stops.length);
    for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    // ...and the HUD maps each one back to the stop the user selected.
    for (const p of [100, 90, 50, 10, 0]) expect(resolutionPercent(resFromPercent(p, maxRes), maxRes)).toBe(p);
  });

  it("a bigger graph (smaller fit scale) needs a BIGGER ceiling to reach the same absolute detail", () => {
    const bigGraphFit = 0.1;   // sparse fit scale — a big graph, everything crammed small at 100%
    const smallGraphFit = 5;   // tight fit scale — a small graph, already fairly detailed at 100%
    expect(maxResFor(bigGraphFit, CELL_W)).toBeGreaterThan(maxResFor(smallGraphFit, CELL_W));
    // The absolute target still WINS wherever it asks for more than the floor — the floor only
    // rescues the degenerate end (see MIN_ZOOM_SPAN).
    expect(maxResFor(bigGraphFit, CELL_W)).toBeGreaterThan(MIN_ZOOM_SPAN);
  });

  it("is otherwise a pure function of pxPerWorld/cellW — not of anything graph-identity-specific", () => {
    expect(maxResFor(2, CELL_W)).toBe(maxResFor(2, CELL_W));
  });

  it("DEEPEST_WORLD_PER_CELL is a fixed positive constant (not derived per-graph)", () => {
    expect(DEEPEST_WORLD_PER_CELL).toBeGreaterThan(0);
  });
});

describe("zoom percent <-> resolution (100% = fit, 0% = deepest, in ZOOM_STEP_PCT steps)", () => {
  it("resFromT is the exact inverse of resolutionT", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(resolutionT(resFromT(t, 16), 16)).toBeCloseTo(t, 10);
    }
  });

  it("resFromPercent: 100% is fit (res=1), 0% is the maxRes ceiling", () => {
    expect(resFromPercent(100, 16)).toBeCloseTo(1, 10);
    expect(resFromPercent(0, 16)).toBeCloseTo(16, 10);
    expect(resFromPercent(50, 16)).toBeCloseTo(4, 10); // sqrt(16), the log-scale midpoint
  });

  it("resolutionPercent/resFromPercent round-trip at every ZOOM_STEP_PCT stop", () => {
    for (let pct = 0; pct <= 100; pct += ZOOM_STEP_PCT) {
      expect(resolutionPercent(resFromPercent(pct, 16), 16)).toBe(pct);
    }
  });

  it("snapZoomPercent rounds to the nearest step and clamps to 0..100", () => {
    expect(snapZoomPercent(94)).toBe(90);
    expect(snapZoomPercent(96)).toBe(100);
    expect(snapZoomPercent(45)).toBe(50);
    expect(snapZoomPercent(-5)).toBe(0);
    expect(snapZoomPercent(105)).toBe(100);
  });
});

describe("compactScale — cell/font size shrinks in a small panel, holds steady in a normal one", () => {
  it("is exactly 1 (no shrink) at or above COMPACT_MAX_DIM", () => {
    expect(compactScale(COMPACT_MAX_DIM, COMPACT_MAX_DIM)).toBe(1);
    expect(compactScale(1200, 800)).toBe(1);
  });

  it("is driven by the SMALLER dimension — a tall narrow pane shrinks even with plenty of height", () => {
    expect(compactScale(94, 1000)).toBeCloseTo(compactScale(94, 94), 10);
  });

  it("floors at COMPACT_FLOOR_SCALE at or below COMPACT_MIN_DIM, never below it", () => {
    expect(compactScale(COMPACT_MIN_DIM, COMPACT_MIN_DIM)).toBe(COMPACT_FLOOR_SCALE);
    expect(compactScale(10, 10)).toBe(COMPACT_FLOOR_SCALE);
    expect(compactScale(0, 0)).toBe(COMPACT_FLOOR_SCALE);
  });

  it("interpolates monotonically between the floor and 1 across the band", () => {
    let prev = compactScale(COMPACT_MIN_DIM, COMPACT_MIN_DIM);
    for (let d = COMPACT_MIN_DIM; d <= COMPACT_MAX_DIM; d += 10) {
      const s = compactScale(d, d);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
  });

  it("reproduces the reported bug's box (94x276) at a visibly shrunk, non-floored scale", () => {
    const s = compactScale(94, 276);
    expect(s).toBeGreaterThan(COMPACT_FLOOR_SCALE);
    expect(s).toBeLessThan(1);
  });
});
