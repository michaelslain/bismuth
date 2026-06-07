import { test, expect } from "bun:test";
import { smoothStrokePoints } from "../../src/drawing/smooth";

// Max turning angle (radians) between consecutive segments — a direct "kinkiness" measure.
function maxTurn(a: number[]): number {
  let m = 0;
  for (let i = 3; i + 4 < a.length; i += 3) {
    const v1x = a[i] - a[i - 3], v1y = a[i + 1] - a[i - 2];
    const v2x = a[i + 3] - a[i], v2y = a[i + 4] - a[i + 1];
    const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
    if (d < 1e-6) continue;
    let c = (v1x * v2x + v1y * v2y) / d;
    c = Math.max(-1, Math.min(1, c));
    m = Math.max(m, Math.acos(c));
  }
  return m;
}

test("endpoints are kept exact and the curve is densified", () => {
  const pts = [0, 0, 255, 30, 24, 255, 12, 48, 255, 48, 66, 255, 24, 90, 255, 60, 108, 255];
  const out = smoothStrokePoints(pts);
  expect([out[0], out[1]]).toEqual([0, 0]);                              // first kept exact
  expect([out[out.length - 3], out[out.length - 2]]).toEqual([60, 108]); // last kept exact
  expect(out.length).toBeGreaterThan(pts.length);                        // resample + spline adds detail
});

test("a jittery path becomes far less kinky (smooth, not geometric)", () => {
  const pts: number[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 0; i <= 120; i++) pts.push(i * 6 + rnd() * 8, 250 + Math.sin(i / 12) * 90 + rnd() * 8, 255);

  const before = maxTurn(pts), after = maxTurn(smoothStrokePoints(pts));
  expect(after).toBeLessThan(before * 0.5); // markedly smoother
  expect(after).toBeLessThan(0.8);          // and smooth in absolute terms
});

test("a near-straight stroke stays straight (gesture preserved, no overshoot)", () => {
  const pts: number[] = [];
  for (let i = 0; i <= 20; i++) pts.push(i * 5, i * 5, 255); // 45° line
  const out = smoothStrokePoints(pts);
  for (let i = 0; i + 2 < out.length; i += 3) expect(Math.abs(out[i] - out[i + 1])).toBeLessThan(1.5);
});

test("coincident / duplicate points produce no NaN", () => {
  const pts = [10, 10, 255, 10, 10, 255, 10, 10, 255, 40, 40, 255, 40, 40, 255, 80, 20, 255];
  const out = smoothStrokePoints(pts);
  expect(out.every((n) => Number.isFinite(n))).toBe(true);
});

test("pressure stays within byte range after splining", () => {
  const pts = [0, 0, 10, 20, 40, 250, 40, 0, 5, 60, 50, 255, 80, 10, 0];
  const out = smoothStrokePoints(pts);
  for (let i = 2; i < out.length; i += 3) { expect(out[i]).toBeGreaterThanOrEqual(0); expect(out[i]).toBeLessThanOrEqual(255); }
});

test("strokes with fewer than 3 points are returned unchanged", () => {
  expect(smoothStrokePoints([5, 5, 255])).toEqual([5, 5, 255]);
  expect(smoothStrokePoints([0, 0, 255, 10, 10, 255])).toEqual([0, 0, 255, 10, 10, 255]);
});
