import { describe, expect, it } from "bun:test";
import { drawnNodeRadius, nodeCollideRadius } from "./collide";

// The 3D renderer draws nodes with THREE.PointsMaterial + sizeAttenuation, where a point of
// pixel-size S matches a world object of *diameter* S*tan(fov/2). A node's S is nodeSize*scale
// (scale = its degree multiplier), so its drawn world *radius* is nodeSize*scale*tan(fov/2)/2.
describe("drawnNodeRadius", () => {
  it("matches the sizeAttenuation formula (diameter = size*tan(fov/2))", () => {
    // nodeSize 6, hub scale 6, fov 60 -> 6*6*tan(30)/2 = 36*0.57735/2 ≈ 10.39
    expect(drawnNodeRadius(6, 6, 60)).toBeCloseTo(10.392, 2);
    // a base (scale 1) node -> 6*1*tan(30)/2 ≈ 1.732
    expect(drawnNodeRadius(6, 1, 60)).toBeCloseTo(1.732, 2);
  });

  it("grows monotonically with the degree scale", () => {
    expect(drawnNodeRadius(6, 6, 60)).toBeGreaterThan(drawnNodeRadius(6, 1, 60));
    expect(drawnNodeRadius(6, 1, 60)).toBeGreaterThan(drawnNodeRadius(6, 0.4, 60));
  });
});

describe("nodeCollideRadius", () => {
  const FLOOR = 4.5; // linkDistance 5 * COLLIDE_RATIO 0.9, the 3D spacing floor

  it("clamps small (leaf) nodes to the spacing floor so the airy field is preserved", () => {
    // leaf scale 0.4 -> drawn ≈ 0.69, well under the floor
    expect(nodeCollideRadius(FLOOR, 6, 0.4, 60)).toBe(FLOOR);
  });

  it("expands big (hub) nodes to their true drawn radius so circles stop overlapping", () => {
    // hub scale 6 -> drawn ≈ 10.39, above the floor -> use the real radius
    expect(nodeCollideRadius(FLOOR, 6, 6, 60)).toBeCloseTo(10.392, 2);
  });

  it("never returns less than the floor", () => {
    for (const scale of [0, 0.4, 1, 2, 6]) {
      expect(nodeCollideRadius(FLOOR, 6, scale, 60)).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it("padding adds breathing room to big nodes (a visible gap, not just tangent)", () => {
    // hub scale 6: drawn ≈ 10.39; with 1.25 padding the collide radius grows past the bare radius
    expect(nodeCollideRadius(FLOOR, 6, 6, 60, 1.25)).toBeCloseTo(12.99, 2);
    expect(nodeCollideRadius(FLOOR, 6, 6, 60, 1.25)).toBeGreaterThan(nodeCollideRadius(FLOOR, 6, 6, 60, 1));
  });

  it("padding does not pull leaf nodes off the floor", () => {
    // a leaf's padded radius is still under the floor, so the airy field is untouched
    expect(nodeCollideRadius(FLOOR, 6, 0.4, 60, 1.25)).toBe(FLOOR);
  });
});
