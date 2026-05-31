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

// Which drop zone a point falls in within a pane rect. The middle band replaces;
// outside it, the nearest edge wins, with horizontal taking diagonal ties (matches
// the prior pane getDropDir behavior).
export function dropZoneForPoint(rect: Rect, x: number, y: number): Zone {
  const fx = (x - rect.x) / rect.w - 0.5;
  const fy = (y - rect.y) / rect.h - 0.5;
  if (Math.abs(fx) <= CENTER_HALF && Math.abs(fy) <= CENTER_HALF) return "center";
  if (Math.abs(fx) >= Math.abs(fy)) return fx < 0 ? "left" : "right";
  return fy < 0 ? "up" : "down";
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
