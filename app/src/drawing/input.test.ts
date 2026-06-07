import { test, expect } from "bun:test";
import { widthFor } from "./input";

test("widthFor uses real pressure when available, velocity otherwise", () => {
  expect(widthFor({ base: 4, pressure: 1, speed: 0, hasRealPressure: true })).toBeGreaterThan(
    widthFor({ base: 4, pressure: 0.2, speed: 0, hasRealPressure: true }));
  expect(widthFor({ base: 4, pressure: 0.5, speed: 0, hasRealPressure: false })).toBeGreaterThan(
    widthFor({ base: 4, pressure: 0.5, speed: 5, hasRealPressure: false }));
});
