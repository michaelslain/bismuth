// app/src/graphRefreshGate.ts
// Pure decision for App.tsx's graph-refresh effect: given the latest server change and whether
// we've already seen a first live change this session, decide whether to schedule a graph
// refresh — and pure so it can be unit-tested without mounting Solid.
//
// The distinguishing signal for "skip this one" is whether the change carries a `dirty` field, NOT
// whether it happens to be the first change this effect has seen. The SSE stream's initial connect
// snapshot (and the fallback poll) always omit `dirty` (core/src/server.ts's GET /events: the
// initial frame is `{version, paths: []}` with no `dirty` key) — that frame carries no information
// beyond "here's the current version", which the mount's own refreshGraph() call already covers,
// so a SECOND, redundant round trip for it is pure waste.
//
// But the first change this effect ever sees is NOT always that snapshot. The bundled app spawns a
// fresh core for every launch (so the first thing it does IS a version bump, not an inert restate
// of version 0), and a boot-time config-load version bump that used to precede any real edit is
// being removed elsewhere in this plan — so the first live change a real user's install sees is
// typically a genuine structural edit, delivered WITH `dirty: {graph: true, ...}`. Unconditionally
// skipping "the first change" regardless of its shape silently drops that real update. Controller
// ruling 2026-09-13, after this bug was found in review.
export type GraphChange = {
    version: number
    dirty?: { graph: boolean; tree: boolean }
}

export function decideGraphRefresh(
    change: GraphChange,
    sawFirstLiveChange: boolean,
): { refresh: boolean; sawFirstLiveChange: boolean } {
    // version 0 is the pre-any-change starting value (see lastChange()'s initial signal), not a
    // live change at all — never refresh for it, and never count it as "the first change seen".
    if (change.version === 0) return { refresh: false, sawFirstLiveChange }
    // The snapshot/fallback-poll shape (no `dirty`), only the FIRST time it's seen: skip, since the
    // mount fetch already covers it. A later dirty-less change (a real reconnect/poll catch-up)
    // still refreshes below — "absent dirty" ordinarily means "assume everything changed".
    if (!sawFirstLiveChange && change.dirty === undefined)
        return { refresh: false, sawFirstLiveChange: true }
    const refresh = change.dirty?.graph !== false
    return { refresh, sawFirstLiveChange: true }
}
