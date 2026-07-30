import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The default `bun test` must never make a real model API call. A live block that keys off "is the
// CLI installed" runs automatically on every developer machine that has it — which is how this repo
// silently made real API calls against the user's Anthropic account on every full-suite run.
test("no live test block gates on mere CLI presence", () => {
  const src = readFileSync(join(import.meta.dir, "chat.test.ts"), "utf8");
  expect(src).not.toMatch(/const HAS_CLAUDE = whichClaude\(\) !== null;\s*\n\s*const describeOrSkip = HAS_CLAUDE \? describe : describe\.skip;/);
  // The gate must require an explicit opt-in env var.
  expect(src).toMatch(/BISMUTH_LIVE_TESTS/);
});
