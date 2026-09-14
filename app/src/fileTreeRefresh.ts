// app/src/fileTreeRefresh.ts
// Pure decision logic for the file tree's SSE-driven refresh, split out from the
// FileTree component so it can be unit-tested in headless Bun without importing
// the component tree (Solid client components, Solid client-only code, CodeMirror).

/**
 * Pure decision for the SSE-driven tree refresh. Decides whether to refetch and
 * what `lastSeen`/`pendingStructural` become. Extracted from the effect so the
 * gating logic is unit testable without Solid's effect scheduling.
 *
 * Gating (B3): while the user is editing/dragging, OR an optimistic
 * move/rename/create/delete is still awaiting its server round-trip
 * (`pendingOps > 0`), we DEFER — return `refetch: false` WITHOUT advancing
 * `lastSeen`, so the change is picked up once the guard clears and the tracked
 * signals re-run the effect. Otherwise we consume the version (advance
 * `lastSeen`) and refetch unless the change was content-only (`dirty.tree`
 * false); an absent `dirty` means "unknown", so refetch to be safe.
 *
 * `pendingStructural` closes a gap in the above: while deferred, only the
 * LATEST change used to be consulted, so a structural change followed by a
 * content-only one before the guard cleared skipped the refetch entirely —
 * the structural change was lost. `pendingStructural` accumulates "was any
 * change seen while deferred structural (or unknown)" across the whole
 * deferred span, and is what actually decides the refetch once consumed.
 */
export function decideTreeRefresh(args: {
    change: { version: number; dirty?: { tree: boolean } }
    lastSeen: number
    editing: boolean
    dragging: boolean
    pendingOps: number
    pendingStructural: boolean
}): {
    refetch: boolean
    nextLastSeen: number
    nextPendingStructural: boolean
} {
    const { change, lastSeen, editing, dragging, pendingOps, pendingStructural } =
        args
    if (change.version === lastSeen)
        return { refetch: false, nextLastSeen: lastSeen, nextPendingStructural: pendingStructural }
    const structural = change.dirty?.tree !== false
    if (editing || dragging || pendingOps > 0)
        return {
            refetch: false,
            nextLastSeen: lastSeen,
            nextPendingStructural: pendingStructural || structural,
        }
    return {
        refetch: pendingStructural || structural,
        nextLastSeen: change.version,
        nextPendingStructural: false,
    }
}
