// app/src/graphRefreshGate.ts
// Pure decision for App.tsx's graph-refresh effect: given the latest server change, decide
// whether to schedule a graph refresh — pure so it can be unit-tested without mounting Solid.
//
// Controller ruling 2026-09-13 (wave 2 review): an earlier version of this function also skipped
// the very FIRST live change it ever saw, on the theory that the first change is always the SSE
// stream's initial "here's the current version" snapshot (no `dirty` field), which the mount's own
// refreshGraph() call already covers. That reasoning was false: Task 3 removed the boot
// config-load version bump, so a fresh core stays at version 0, and GET /events only sends its
// initial snapshot when version > 0 — so the first change a client actually sees can just as
// easily be a genuine poll catch-up (`fireChange({version, paths: []})`, no `dirty`) or a reconnect
// snapshot covering real edits missed while SSE was down. Both carry a real, uninspected change,
// and the unconditional "skip the first one" rule silently dropped them. There is no special case
// for "first" any more — the only signal that matters is whether THIS change's `dirty.graph` is
// explicitly `false`.
export type GraphChange = {
    version: number
    dirty?: { graph: boolean; tree: boolean }
}

/**
 * version 0 is the pre-any-change starting value (see serverVersion.ts's `lastChange()` initial
 * signal), not a live change at all — never refresh for it. Otherwise, an absent `dirty` means
 * "extent unknown — assume everything changed" (a poll catch-up or reconnect snapshot, or the
 * initial SSE connect), so it refreshes like anything else; `dirty.graph === false` is the only
 * case that skips a real round trip.
 */
export function decideGraphRefresh(change: GraphChange): boolean {
    if (change.version === 0) return false
    return change.dirty?.graph !== false
}
