import { test, expect } from "bun:test";
import { shouldRunSlowTests, shouldRunQuarantinedTests } from "./slowGate";

test("slow suites run by default — an unset env must never silently drop coverage", () => {
  expect(shouldRunSlowTests({})).toBe(true);
  expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: undefined })).toBe(true);
});

test("only the exact string \"1\" opts out, so a stray value cannot disable suites by accident", () => {
  expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: "1" })).toBe(false);
  expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: "0" })).toBe(true);
  expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: "true" })).toBe(true);
  expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: "" })).toBe(true);
});

test("it is independent of the live-test gate (opposite polarity, no shared env key)", () => {
  expect(shouldRunSlowTests({ BISMUTH_LIVE_TESTS: "1" })).toBe(true);
});

test("quarantined suites are opt-IN, so a known flake never blocks a push by default", () => {
  expect(shouldRunQuarantinedTests({})).toBe(false);
  expect(shouldRunQuarantinedTests({ BISMUTH_RUN_QUARANTINED: "1" })).toBe(true);
  expect(shouldRunQuarantinedTests({ BISMUTH_RUN_QUARANTINED: "0" })).toBe(false);
  // Independent of the slow gate: running slow suites must not drag quarantined ones back in.
  expect(shouldRunQuarantinedTests({ BISMUTH_FAST_TESTS: "0" })).toBe(false);
});
