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

/**
 * Pick a non-colliding name for a new child of `parentDir` ("" = vault root), given the
 * current tree `entries`. Mirrors the server's uniqueAssetPath: appends " 1", " 2", … to the
 * STEM (before the extension) until the resulting vault-relative path is free — e.g.
 * "Untitled.md" → "Untitled 1.md", "New Folder" → "New Folder 1". `name` is the full default
 * name including any extension; returns just the chosen name (not the joined path).
 *
 * This lets two fast "New note" / "New Folder" creates land as DISTINCT rows: without it both
 * resolve to the same path, so the 2nd optimistic add dedups to a no-op and the 2nd POST /create
 * 409s (EEXIST) — tearing down the 1st row's inline-rename box. Because the 1st create's optimistic
 * add is already reflected in `entries`, the 2nd call deterministically picks the next free name.
 */
export function uniqueChildName(entries: TreeEntry[], parentDir: string, name: string): string {
  const taken = new Set(entries.map((e) => e.path));
  const at = (n: string) => (parentDir ? `${parentDir}/${n}` : n);
  if (!taken.has(at(name))) return name;
  // Split stem/ext the way uniqueAssetPath does: a leading-dot or no-dot name has no ext, so
  // the whole name is the stem (folders and dotfiles get the suffix appended at the end).
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const ext = dot <= 0 ? "" : name.slice(dot);
  for (let i = 1; i < 10000; i++) {
    const cand = `${stem} ${i}${ext}`;
    if (!taken.has(at(cand))) return cand;
  }
  return `${stem} ${Date.now()}${ext}`; // pathological fallback
}
