import { describe, expect, it } from "bun:test";
import { dropZoneForPoint, nearestEdge, insertionIndexForX, type Rect } from "./geometry";

const R: Rect = { x: 0, y: 0, w: 100, h: 100 };

describe("nearestEdge", () => {
  it("always returns an edge — no center band", () => {
    expect(nearestEdge(R, 50, 50)).toBe("right"); // dead center → horizontal tie → right
    expect(nearestEdge(R, 45, 50)).toBe("left");
    expect(nearestEdge(R, 50, 45)).toBe("up");
    expect(nearestEdge(R, 50, 55)).toBe("down");
  });

  it("agrees with dropZoneForPoint outside the center band", () => {
    for (const [x, y] of [[8, 50], [92, 50], [50, 8], [50, 92]] as const) {
      expect(nearestEdge(R, x, y)).toBe(dropZoneForPoint(R, x, y));
    }
  });
});

describe("dropZoneForPoint", () => {
  it("returns center for a point in the middle band", () => {
    expect(dropZoneForPoint(R, 50, 50)).toBe("center");
  });

  it("returns the nearest edge for points well outside the center band", () => {
    expect(dropZoneForPoint(R, 8, 50)).toBe("left");
    expect(dropZoneForPoint(R, 92, 50)).toBe("right");
    expect(dropZoneForPoint(R, 50, 8)).toBe("up");
    expect(dropZoneForPoint(R, 50, 92)).toBe("down");
  });

  it("breaks the diagonal tie toward the horizontal edge", () => {
    // dx slightly larger than dy → horizontal wins (matches existing pane getDropDir)
    expect(dropZoneForPoint(R, 10, 12)).toBe("left");
    expect(dropZoneForPoint(R, 90, 12)).toBe("right");
  });

  it("is independent of the rect's origin offset", () => {
    const offset: Rect = { x: 500, y: 300, w: 100, h: 100 };
    expect(dropZoneForPoint(offset, 550, 350)).toBe("center");
    expect(dropZoneForPoint(offset, 508, 350)).toBe("left");
    expect(dropZoneForPoint(offset, 550, 392)).toBe("down");
  });
});

describe("insertionIndexForX", () => {
  // three chips: [0,100), [100,200), [200,300) → midpoints 50,150,250
  const chips = [
    { x: 0, w: 100 },
    { x: 100, w: 100 },
    { x: 200, w: 100 },
  ];

  it("returns 0 left of the first chip's midpoint", () => {
    expect(insertionIndexForX(chips, 10)).toBe(0);
  });

  it("returns the count of midpoints left of the cursor", () => {
    expect(insertionIndexForX(chips, 60)).toBe(1); // past mid0
    expect(insertionIndexForX(chips, 140)).toBe(1); // before mid1
    expect(insertionIndexForX(chips, 160)).toBe(2); // past mid1
  });

  it("returns n past the last chip's midpoint", () => {
    expect(insertionIndexForX(chips, 260)).toBe(3);
    expect(insertionIndexForX(chips, 9999)).toBe(3);
  });

  it("returns 0 for an empty strip", () => {
    expect(insertionIndexForX([], 50)).toBe(0);
  });
});
