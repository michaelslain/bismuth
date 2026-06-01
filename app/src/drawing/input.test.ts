import { test, expect } from "bun:test";
import { streamlinePoint, widthFor } from "./input";

test("streamlinePoint moves the filtered point a fraction toward the raw point", () => {
  const filt = { x: 0, y: 0 };
  const next = streamlinePoint(filt, { x: 10, y: 0 }, 0.6); // strength 0.6 => move 40%
  expect(next.x).toBeCloseTo(4, 5);
  expect(next.y).toBe(0);
});

test("widthFor uses real pressure when available, velocity otherwise", () => {
  expect(widthFor({ base: 4, pressure: 1, speed: 0, hasRealPressure: true })).toBeGreaterThan(
    widthFor({ base: 4, pressure: 0.2, speed: 0, hasRealPressure: true }));
  expect(widthFor({ base: 4, pressure: 0.5, speed: 0, hasRealPressure: false })).toBeGreaterThan(
    widthFor({ base: 4, pressure: 0.5, speed: 5, hasRealPressure: false }));
});
