// Pure reducers for the kanban's OPTIMISTIC DELETE/UNDO overlay.
//
// Deleting a card hides its row INSTANTLY — before the server round-trip confirms it — so the
// card vanishes with no wait and no full-board reload (the delete's SSE revalidation lands
// smoothly behind the overlay). The overlay is reverted on failure, cleared on undo, and pruned
// once a refetch confirms the delete for good.
//
// Keyed by id (`rowIdentity.ts`'s `rowId`), NOT by path alone: two very different row shapes
// share this overlay.
//   - A NOTE row's id is its file path — stable across a delete, since deleting a note removes
//     that exact path. Hiding by id alone is correct and permanent until the refetch drops it.
//   - A STORED row's id is `${basePath}#${index}` (rowIdentity.ts) — and deleting ANY stored row
//     splices `rows.splice(index, 1)` (core/src/bases/rowOps.ts), shifting every LATER row's
//     index (and so its id) down by one. The card that used to be at index k+1 refetches AT
//     index k — the id this overlay is still hiding — and would stay hidden forever with a
//     bare id-keyed set. So a stored-row entry also carries a SNAPSHOT (JSON of `storedNote`) of
//     the row that was actually deleted: the id only hides a row while the row currently AT that
//     id still matches the snapshot of the row that was deleted. Once a different row's content
//     shifts into that id, the entry no longer matches and stops hiding it.
//
// `snapshot === undefined` marks a note-row entry (id-only match, original behavior).
export type DeletedMap = ReadonlyMap<string, string | undefined>

/** Add an id to the hidden overlay (optimistic delete). `snapshot` is the JSON of the deleted
 *  stored row's `storedNote` — omitted for a note row, whose id alone is a stable identity.
 *  Returns a NEW map so a Solid signal set sees a fresh reference and re-renders. */
export function markDeleted(
    prev: DeletedMap,
    id: string,
    snapshot?: string,
): DeletedMap {
    const next = new Map(prev)
    next.set(id, snapshot)
    return next
}

/** Remove an id from the hidden overlay (the delete FAILED, or an undo restored the row).
 *  Returns the SAME reference when the id wasn't hidden, so a no-op doesn't re-render. */
export function unmarkDeleted(prev: DeletedMap, id: string): DeletedMap {
    if (!prev.has(id)) return prev
    const next = new Map(prev)
    next.delete(id)
    return next
}

/** Whether the row currently at `id` (its current stored-row snapshot, or `undefined` for a
 *  note row) should be hidden by the overlay. A note-row entry (`snapshot === undefined`) hides
 *  by id alone. A stored-row entry hides only while `currentSnapshot` still matches the
 *  snapshot of the row that was actually deleted — once a shifted sibling's content lands at
 *  that id, this returns false and the sibling shows. */
export function isRowHidden(
    prev: DeletedMap,
    id: string,
    currentSnapshot: string | undefined,
): boolean {
    if (!prev.has(id)) return false
    const snap = prev.get(id)
    if (snap === undefined) return true
    return snap === currentSnapshot
}

/** Prune every hidden entry the server data no longer backs — the delete's refetch has landed,
 *  so the optimistic hide is now redundant (or, for a stored row, wrong: the id now belongs to
 *  a shifted sibling, and keeping the entry would wrongly hide THAT card). `present` maps every
 *  currently-live row's id to its current snapshot (`undefined` for a note row). An entry
 *  survives only while `present` still has its id AND (for a stored-row entry) the snapshot
 *  still matches — anything else is pruned, deleted-for-real or shifted-away alike. Returns the
 *  SAME reference when nothing changed. */
export function pruneDeleted(
    prev: DeletedMap,
    present: ReadonlyMap<string, string | undefined>,
): DeletedMap {
    let changed = false
    const next = new Map(prev)
    for (const [id, snap] of prev) {
        if (!(present.has(id) && present.get(id) === snap)) {
            next.delete(id)
            changed = true
        }
    }
    return changed ? next : prev
}
