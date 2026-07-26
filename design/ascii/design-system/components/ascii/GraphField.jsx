import React from "react";
import { Glyph, noiseField } from "./Glyph";

/** Bresenham line rasterized into characters: - | / \ with + at junctions. */
export function rasterEdges(cols, rows, nodes, edges) {
  const grid = [];
  for (let r = 0; r < rows; r++) grid.push(new Array(cols).fill(" "));
  const put = (x, y, ch) => { if (y >= 0 && y < rows && x >= 0 && x < cols) grid[y][x] = ch; };
  edges.forEach(([ai, bi]) => {
    const a = nodes[ai], b = nodes[bi];
    if (!a || !b) return;
    let x = a.x, y = a.y;
    const dx = Math.abs(b.x - x), dy = Math.abs(b.y - y);
    const sx = b.x > x ? 1 : -1, sy = b.y > y ? 1 : -1;
    let err = dx - dy, guard = 0;
    while (guard++ < 2000 && !(x === b.x && y === b.y)) {
      const e2 = 2 * err;
      let mx = false, my = false;
      if (e2 > -dy) { err -= dy; x += sx; mx = true; }
      if (e2 < dx) { err += dx; y += sy; my = true; }
      put(x, y, mx && my ? (sx === sy ? "\\" : "/") : mx ? "-" : "|");
    }
  });
  nodes.forEach((n) => put(n.x, n.y, "+"));
  return grid.map((r) => r.join("")).join("\n");
}

/**
 * The knowledge graph. Three stacked character layers — noise, edges, nodes —
 * with the noise field OFF by default: it is texture, and the edges have to read first.
 * plus absolutely positioned labels. Zoom is RESOLUTION: the cell never changes
 * size, the grid subdivides.
 */
export function GraphField({ cols = 110, rows = 60, nodes = [], edges = [], labels = [],
                             density = 0.34, showNoise = false, showEdges = true, style, children }) {
  return (
    <div className="asc-field" style={{ flex: 1, ...style }}>
      {showNoise ? (
        <Glyph className="noise" text={noiseField(cols, rows, density)}
               style={{ padding: "10px 0 0 8px", position: "absolute", left: 0, top: 0 }}
               color="var(--faint)" opacity={0.45} />
      ) : null}
      {showEdges ? (
        <Glyph className="edges" text={rasterEdges(cols, rows, nodes, edges)} glow
               style={{ padding: "10px 0 0 8px", position: "absolute", left: 0, top: 0 }}
               color="var(--accent)" />
      ) : null}
      {labels.map((l) => (
        <span key={l.text} className={["asc-node-label", l.active ? "active" : ""].filter(Boolean).join(" ")}
              style={{ left: l.left, top: l.top, color: l.color }}>{l.text}</span>
      ))}
      {children}
    </div>
  );
}
