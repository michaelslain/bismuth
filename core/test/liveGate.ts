/**
 * Pure gate for tests that would make real calls against the user's Anthropic account (spawning
 * the actual `claude` binary). `bun test` must never take this path by default — only an explicit
 * opt-in, and only when the binary is actually there to opt into.
 *
 * Kept as a tiny standalone predicate (rather than inlined in chat.test.ts) so its full truth
 * table is unit-testable without needing the `claude` binary or the chat/SDK modules at all —
 * see liveGate.test.ts.
 */
export function shouldRunLiveTests(env: Record<string, string | undefined>, hasBinary: boolean): boolean {
  return env.BISMUTH_LIVE_TESTS === "1" && hasBinary;
}
