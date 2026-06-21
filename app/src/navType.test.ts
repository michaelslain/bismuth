import { test, expect } from "bun:test";
import { isReloadNavigation } from "./navType";

const perfWith = (type: string): Performance =>
  ({ getEntriesByType: (k: string) => (k === "navigation" ? [{ type }] : []) }) as unknown as Performance;

test("a reload navigation is detected (Navigation Timing)", () => {
  expect(isReloadNavigation(perfWith("reload"))).toBe(true);
});

test("a fresh navigate is NOT a reload (cold launch)", () => {
  expect(isReloadNavigation(perfWith("navigate"))).toBe(false);
});

test("back_forward is NOT treated as a reload", () => {
  expect(isReloadNavigation(perfWith("back_forward"))).toBe(false);
});

test("falls back to legacy performance.navigation.type === 1", () => {
  const perf = { getEntriesByType: () => [], navigation: { type: 1 } } as unknown as Performance;
  expect(isReloadNavigation(perf)).toBe(true);
});

test("legacy navigate (type 0) is not a reload", () => {
  const perf = { getEntriesByType: () => [], navigation: { type: 0 } } as unknown as Performance;
  expect(isReloadNavigation(perf)).toBe(false);
});

test("no navigation info → not a reload (safe default: cold launch starts fresh)", () => {
  expect(isReloadNavigation({ getEntriesByType: () => [] } as unknown as Performance)).toBe(false);
});

test("a throwing perf object is handled (returns false)", () => {
  const perf = { getEntriesByType: () => { throw new Error("nope"); } } as unknown as Performance;
  expect(isReloadNavigation(perf)).toBe(false);
});
