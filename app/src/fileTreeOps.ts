// app/src/fileTreeOps.ts
// Pure manipulations of the /tree entry list, used for optimistic file-tree edits
// (rename/move, delete, create) so the sidebar updates instantly before the
// server round-trip. Each returns a new array; the input is never mutated.
import type { TreeEntry } from "../../core/src/graph";

/** True if `path` is `prefix` itself or a descendant of it. */
function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/**
 * Rename/move `from` → `to`. Rewrites the entry itself and every descendant
 * (so moving a folder carries its children). Other entries pass through.
 */
export function renameEntries(entries: TreeEntry[], from: string, to: string): TreeEntry[] {
  return entries.map((e) =>
    isUnder(e.path, from) ? { ...e, path: to + e.path.slice(from.length) } : e,
  );
}

/** Remove `path` and any descendants (deleting a folder drops its children). */
export function removeEntries(entries: TreeEntry[], path: string): TreeEntry[] {
  return entries.filter((e) => !isUnder(e.path, path));
}

/** Add a new entry. No-op if an entry at `path` already exists. */
export function addEntry(entries: TreeEntry[], path: string, kind: "file" | "dir"): TreeEntry[] {
  if (entries.some((e) => e.path === path)) return entries;
  return [...entries, { path, kind }];
}
