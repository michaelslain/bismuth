// app/src/fileTreeRefresh.ts
// Pure decision logic for the file tree's SSE-driven refresh, split out from the
// FileTree component so it can be unit-tested in headless Bun without importing
// the component tree (Solid client components, lucide-solid icons, CodeMirror).

/**
 * Pure decision for the SSE-driven tree refresh. Decides whether to refetch and
 * what `lastSeen` becomes. Extracted from the effect so the gating logic is unit
 * testable without Solid's effect scheduling.
 *
 * Gating (B3): while the user is editing/dragging, OR an optimistic
 * move/rename/create/delete is still awaiting its server round-trip
 * (`pendingOps > 0`), we DEFER — return `refetch: false` WITHOUT advancing
 * `lastSeen`, so the change is picked up once the guard clears and the tracked
 * signals re-run the effect. Otherwise we consume the version (advance
 * `lastSeen`) and refetch unless the change was content-only (`dirty.tree`
 * false); an absent `dirty` means "unknown", so refetch to be safe.
 */
export function decideTreeRefresh(args: {
  change: { version: number; dirty?: { tree: boolean } };
  lastSeen: number;
  editing: boolean;
  dragging: boolean;
  pendingOps: number;
}): { refetch: boolean; nextLastSeen: number } {
  const { change, lastSeen, editing, dragging, pendingOps } = args;
  if (change.version === lastSeen) return { refetch: false, nextLastSeen: lastSeen };
  if (editing || dragging || pendingOps > 0) return { refetch: false, nextLastSeen: lastSeen };
  return { refetch: change.dirty?.tree !== false, nextLastSeen: change.version };
}
