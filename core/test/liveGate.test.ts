import { test, expect } from "bun:test";
import { shouldRunLiveTests } from "./liveGate";

// The default `bun test` must never make a real API call against the user's Anthropic account.
// A gate that keys off "is the CLI installed" alone runs automatically on every developer machine
// that has it — which is how this repo silently made real API calls on every full-suite run. This
// truth table asserts the gate's actual semantics (not a source-text pattern), so a refactor that
// renames the constant or drops half the condition fails here instead of silently reintroducing
// the bug.
test("shouldRunLiveTests: full truth table", () => {
  // env opted in + binary present → the only case that runs live.
  expect(shouldRunLiveTests({ BISMUTH_LIVE_TESTS: "1" }, true)).toBe(true);
  // env opted in but no binary → opting in on a machine without `claude` must skip cleanly, not throw.
  expect(shouldRunLiveTests({ BISMUTH_LIVE_TESTS: "1" }, false)).toBe(false);
  // binary present but no opt-in → the exact case this task exists for: presence alone must NOT run live.
  expect(shouldRunLiveTests({}, true)).toBe(false);
  // neither → skip.
  expect(shouldRunLiveTests({}, false)).toBe(false);
});

test("shouldRunLiveTests: the gate is not presence-only — binary presence never substitutes for the opt-in", () => {
  expect(shouldRunLiveTests({ BISMUTH_LIVE_TESTS: undefined }, true)).toBe(false);
  expect(shouldRunLiveTests({ BISMUTH_LIVE_TESTS: "0" }, true)).toBe(false);
  // Exact "1" is required — a merely-truthy value must not opt in.
  expect(shouldRunLiveTests({ BISMUTH_LIVE_TESTS: "true" }, true)).toBe(false);
});
