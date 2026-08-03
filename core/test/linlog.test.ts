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

test("attracts even at sub-unit distances (log1p, not log)", () => {
  // A 2D layout pass can put linked nodes only fractions of a unit apart along one axis
  // (see core/src/layout.ts:200-203 — z-only separation collapses onto the same XY). ln(d)
  // goes negative below d=1 and would repel; ln(1+d) stays positive for every d > 0.
  const nodes = [node("a", 0, 0), node("b", 0.5, 1)];
  const f = linLogLinkForce<TN, { source: string; target: string }>(
    [{ source: "a", target: "b" }], { id: (n) => n.id, strength: () => 1, dim: 3 },
  );
  f.initialize(nodes);
  f(1);
  expect(nodes[0].vx).toBeGreaterThan(0);   // still an attraction, not a repulsive kick
});

test("velocity scales linearly with alpha", () => {
  const build = (alpha: number) => {
    const nodes = [node("a", 0, 0), node("b", 10, 1)];
    const f = linLogLinkForce<TN, { source: string; target: string }>(
      [{ source: "a", target: "b" }], { id: (n) => n.id, strength: () => 1, dim: 3 },
    );
    f.initialize(nodes);
    f(alpha);
    return nodes[0].vx;
  };
  expect(build(0.5)).toBeCloseTo(build(1) * 0.5, 10);
});

test("dim gates the z axis (oblique 3-4-5 triangle)", () => {
  const build = (dim: 2 | 3) => {
    const nodes: TN[] = [
      { index: 0, id: "a", x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      { index: 1, id: "b", x: 3, y: 0, z: 4, vx: 0, vy: 0, vz: 0 },
    ];
    const f = linLogLinkForce<TN, { source: string; target: string }>(
      [{ source: "a", target: "b" }], { id: (n) => n.id, strength: () => 1, dim },
    );
    f.initialize(nodes);
    f(1);
    return nodes;
  };

  const n3 = build(3);
  expect(n3[0].vz).toBeGreaterThan(0);   // dim: 3 → z contributes to distance and gets a force
  expect(n3[1].vz).toBeLessThan(0);
  expect(n3[0].vx).toBeCloseTo(3 * (Math.log1p(5) / 5), 10);   // d = sqrt(3^2 + 4^2) = 5

  const n2 = build(2);
  expect(n2[0].vz).toBe(0);              // dim: 2 → z excluded entirely, vz left untouched
  expect(n2[1].vz).toBe(0);
  expect(n2[0].vx).toBeCloseTo(3 * (Math.log1p(3) / 3), 10);   // d = sqrt(3^2) = 3
});

test("unknown link ids are skipped, and re-initialize does not double the force", () => {
  const links = [
    { source: "a", target: "b" },
    { source: "a", target: "ghost" },   // not present in the node array
  ];
  const f = linLogLinkForce<TN, { source: string; target: string }>(
    links, { id: (n) => n.id, strength: () => 1, dim: 3 },
  );

  const nodes = [node("a", 0, 0), node("b", 10, 1)];
  f.initialize(nodes);
  expect(() => f(1)).not.toThrow();

  const nodes2 = [node("a", 0, 0), node("b", 10, 1)];
  f.initialize(nodes2);
  f.initialize(nodes2);   // re-initialize must reset pairs, not accumulate them
  f(1);
  expect(nodes2[0].vx).toBeCloseTo(Math.log1p(10), 10);   // d = 10 → mag = ln(11)/10, vx = ln(11)
});
