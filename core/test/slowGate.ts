/**
 * Pure gate for SLOW test suites — the ones that spawn real agent binaries or run a full layout
 * simulation, and cost tens of seconds each.
 *
 * The sibling of liveGate.ts, with the opposite polarity, and deliberately so:
 *   - liveGate is opt-IN  (`BISMUTH_LIVE_TESTS=1`) because those tests bill a real account.
 *   - this  is  opt-OUT (`BISMUTH_FAST_TESTS=1`) because these tests are merely slow.
 *
 * Default (unset) therefore RUNS everything, so `bun test` and CI keep their full coverage and
 * nobody can lose a suite by forgetting a flag. Only the pre-commit gate (scripts/gate.ts) sets
 * the opt-out, trading ~70s of per-commit latency for coverage that pre-push then re-runs in full.
 *
 * Kept as a tiny standalone predicate so its truth table is unit-testable without any of the heavy
 * suites — see slowGate.test.ts.
 */
export function shouldRunSlowTests(env: Record<string, string | undefined>): boolean {
  return env.BISMUTH_FAST_TESTS !== "1";
}
