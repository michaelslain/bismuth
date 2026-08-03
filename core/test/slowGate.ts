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

/**
 * Gate for QUARANTINED suites: tests that are known to fail intermittently for a diagnosed reason
 * that is NOT their own fault, and whose real fix is a separate production change.
 *
 * Opt-IN (`BISMUTH_RUN_QUARANTINED=1`), so they do not run by default.
 *
 * This is a deliberate, narrow trade and it deserves suspicion. Since `.githooks/pre-push` makes
 * the full suite BLOCK a push, a test that fails ~1 run in 3 does not "keep us honest" — it trains
 * everyone to reach for `--no-verify`, which silently disables the gate for everything else too. A
 * flaky test in a blocking gate is worse than no test, so quarantine buys the gate's credibility
 * back. The cost is real: the quarantined area is unguarded until its bug is fixed.
 *
 * The bar for adding one: the failure mechanism is UNDERSTOOD and written down, the fix is
 * identified, and it is tracked — not "this is annoying, make it stop". Everything quarantined must
 * be listed here so the list stays short and visible:
 *
 *   - core/test/chatProviders/opencodeMocked.test.ts — opencode server mode's per-session SSE
 *     listener is registered but not confirmed live before `session.prompt()` is issued, so a turn
 *     can complete before the listener catches its streamed deltas and ZERO `assistant-text`
 *     frames arrive (~33% of runs, independent of machine load; see that file's header for the
 *     frame-level instrumentation). This is a REAL user-facing bug — an opencode chat can silently
 *     lose its streamed reply — and the fix belongs in `runTurnServer`
 *     (core/src/chatProviders/opencode.ts): confirm the registration is live, replacing the
 *     mock-side `--latency` margin with an actual synchronization point.
 *
 * Run them with: `BISMUTH_RUN_QUARANTINED=1 bun test core/test/chatProviders/opencodeMocked.test.ts`
 */
export function shouldRunQuarantinedTests(env: Record<string, string | undefined>): boolean {
  return env.BISMUTH_RUN_QUARANTINED === "1";
}
