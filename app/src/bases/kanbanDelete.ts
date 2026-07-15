// Pure reducers for the kanban's OPTIMISTIC DELETE/UNDO overlay.
//
// Deleting a card hides its note path from every column INSTANTLY — before the server round-trip
// confirms it — so the card vanishes with no wait and no full-board reload (the delete's SSE
// revalidation lands smoothly behind the overlay). The set is reverted on failure, cleared on undo,
// and pruned once a refetch drops the path for good. Kept pure + unit-tested so "card vanishes
// instantly, undo restores it, no stale hides / no unbounded growth" can't silently regress.

/** Add a path to the hidden set (optimistic delete). Returns a NEW set so a Solid signal set sees a
 *  fresh reference and re-renders. */
export function markDeleted(prev: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(prev);
  next.add(path);
  return next;
}

/** Remove a path from the hidden set (the delete FAILED, or an undo restored the note). Returns the
 *  SAME reference when the path wasn't hidden, so a no-op doesn't trigger a needless re-render. */
export function unmarkDeleted(prev: ReadonlySet<string>, path: string): Set<string> {
  if (!prev.has(path)) return prev as Set<string>;
  const next = new Set(prev);
  next.delete(path);
  return next;
}

/** Prune every hidden path the server data no longer contains — the delete's refetch has landed, so
 *  the optimistic hide is now redundant (keeping it would leak, and could wrongly hide a LATER note
 *  that reuses the same path). Returns the SAME reference when nothing changed. */
export function pruneDeleted(prev: ReadonlySet<string>, present: ReadonlySet<string>): Set<string> {
  let changed = false;
  const next = new Set(prev);
  for (const p of prev) {
    if (!present.has(p)) {
      next.delete(p);
      changed = true;
    }
  }
  return changed ? next : (prev as Set<string>);
}
