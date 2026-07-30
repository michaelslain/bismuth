import { expect, test } from "bun:test";
import { linLogLinkForce } from "../src/linlog";

interface TN { index: number; id: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }
const node = (id: string, x: number, index: number): TN =>
  ({ index, id, x, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });

test("pulls two linked nodes toward each other", () => {
  const nodes = [node("a", 0, 0), node("b", 10, 1)];
  const f = linLogLinkForce<TN, { source: string; target: string }>(
    [{ source: "a", target: "b" }], { id: (n) => n.id, strength: () => 1, dim: 3 },
  );
  f.initialize(nodes);
  f(1);
  expect(nodes[0].vx).toBeGreaterThan(0);   // a pulled right, toward b
  expect(nodes[1].vx).toBeLessThan(0);      // b pulled left, toward a
});

test("attraction grows only logarithmically with distance", () => {
  const measure = (sep: number) => {
    const nodes = [node("a", 0, 0), node("b", sep, 1)];
    const f = linLogLinkForce<TN, { source: string; target: string }>(
      [{ source: "a", target: "b" }], { id: (n) => n.id, strength: () => 1, dim: 3 },
    );
    f.initialize(nodes);
    f(1);
    return Math.abs(nodes[0].vx);
  };
  const near = measure(10), far = measure(100);
  expect(far).toBeGreaterThan(near);
  // A Hooke spring would give 10x. ln(101)/ln(11) is well under 2x.
  expect(far / near).toBeLessThan(2.5);
});

test("coincident nodes produce no NaN", () => {
  const nodes = [node("a", 0, 0), node("b", 0, 1)];
  const f = linLogLinkForce<TN, { source: string; target: string }>(
    [{ source: "a", target: "b" }], { id: (n) => n.id, strength: () => 1, dim: 3 },
  );
  f.initialize(nodes);
  f(1);
  expect(Number.isFinite(nodes[0].vx)).toBe(true);
  expect(Number.isFinite(nodes[1].vx)).toBe(true);
});

test("per-link strength is honoured", () => {
  const build = (s: number) => {
    const nodes = [node("a", 0, 0), node("b", 10, 1)];
    const f = linLogLinkForce<TN, { source: string; target: string }>(
      [{ source: "a", target: "b" }], { id: (n) => n.id, strength: () => s, dim: 3 },
    );
    f.initialize(nodes);
    f(1);
    return Math.abs(nodes[0].vx);
  };
  expect(build(2)).toBeCloseTo(build(1) * 2, 6);
});
