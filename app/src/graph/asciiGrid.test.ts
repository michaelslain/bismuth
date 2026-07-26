// app/src/graph/asciiGrid.test.ts
// The pure half of the ASCII graph: grid mapping, the degree/depth glyph ramp, the Bresenham edge
// trace with "+" junctions, and the cell hit test. The 3D camera math itself is copied verbatim
// from CanvasGraphRenderer and already proven, so it isn't re-tested here.
import { describe, expect, it } from "bun:test";
import {
  CELL_H, CELL_W, NODE_GLYPHS, PAD_X, PAD_Y,
  cellToPx, degreeTier, depthAlpha, depthBand, fitPxPerWorld, glyphTier, gridMetrics, inGrid,
  mergeEdgeChar, mergeEdgeCode, nearestCellNode, nodeGlyph, pxToCell, resolutionPercent, snapToCell, traceEdge,
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

  it("reports 0% at fit and 100% at maximum resolution", () => {
    expect(resolutionPercent(1, 16)).toBe(0);
    expect(resolutionPercent(16, 16)).toBe(100);
    expect(resolutionPercent(4, 16)).toBe(50);
    expect(resolutionPercent(0.1, 16)).toBe(0); // clamped — you cannot zoom out past fit
  });
});
