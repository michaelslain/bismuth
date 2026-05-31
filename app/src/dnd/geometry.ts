// app/src/dnd/geometry.ts
// Pure geometry for the view-drag system: where does a point land inside a pane
// (which split direction / center-replace), and where would a dragged tab chip
// insert among the strip. No DOM — fully unit-testable.

export type Zone = "left" | "right" | "up" | "down" | "center";
export type Rect = { x: number; y: number; w: number; h: number };

// Half-width (as a fraction of the pane, measured from center) of the square
// "replace" band. 0.18 → the middle ~36% on each axis replaces; everything
// outside splits along its nearest edge.
const CENTER_HALF = 0.18;

// Nearest edge of a rect to a point — horizontal wins diagonal ties. No center
// band: used directly by file-tree drops (which always split) and as the edge
// half of dropZoneForPoint.
export function nearestEdge(rect: Rect, x: number, y: number): Exclude<Zone, "center"> {
  const fx = (x - rect.x) / rect.w - 0.5;
  const fy = (y - rect.y) / rect.h - 0.5;
  if (Math.abs(fx) >= Math.abs(fy)) return fx < 0 ? "left" : "right";
  return fy < 0 ? "up" : "down";
}

// Which drop zone a point falls in within a pane rect. The middle band replaces;
// outside it, the nearest edge wins.
export function dropZoneForPoint(rect: Rect, x: number, y: number): Zone {
  const fx = (x - rect.x) / rect.w - 0.5;
  const fy = (y - rect.y) / rect.h - 0.5;
  if (Math.abs(fx) <= CENTER_HALF && Math.abs(fy) <= CENTER_HALF) return "center";
  return nearestEdge(rect, x, y);
}

// Insertion index (0..n) where a dragged chip would land among `chips` (in DOM
// order) for a cursor at `x`: the number of chips whose horizontal midpoint sits
// left of the cursor.
export function insertionIndexForX(chips: { x: number; w: number }[], x: number): number {
  let i = 0;
  for (const c of chips) {
    if (c.x + c.w / 2 < x) i++;
  }
  return i;
}
