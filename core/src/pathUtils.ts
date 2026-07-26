/** Unified path utilities for vault path handling. */
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/** Extract the basename (filename without .md or .base extension) from a path. */
export function fileBasename(path: string): string {
  const name = path.split("/").pop() ?? "";
  return name.replace(/\.md$/i, "").replace(/\.base$/i, "");
}

/** True for paths under the OS temp root(s) — throwaway by definition (mkdtemp test sandboxes,
 *  a dev server pointed at a temp dir), never something that belongs in a PERSISTENT, machine-wide
 *  registry (the run registry, the daemon's vaults.json). Shared by core/src/daemon.ts
 *  (registerVaultRoot) and core/src/runRegistry.ts (readRunRecords) so the two don't grow separate,
 *  possibly-drifting copies of the same guard.
 *
 *  IMPORTANT: a temp path is a reason to decline to REGISTER a record, or to EXCLUDE one from
 *  returned results — it is NEVER a licence to DELETE a record whose owning process is still
 *  alive. Liveness is the only licence to delete. See `readRunRecords` in runRegistry.ts. */
export function isTempPath(p: string): boolean {
  const roots = [resolve(tmpdir()), "/tmp", "/private/tmp", "/var/folders"];
  return roots.some((r) => p === r || p.startsWith(r + "/"));
}

/**
 * The trailing extension the app HIDES from the user in a file name — markdown notes and
 * YAML configs alike, the way Obsidian hides `.md`. The file tree strips it for display and
 * re-applies it when an inline rename commits (`app/src/FileTree.tsx`), and new-note
 * templating derives `{{title}}` from it (`noteStem` below). Shared so those two can't drift
 * — a mismatch is how a note ends up titled "Grocery List.md" in one place and
 * "Grocery List" in another. Stateless (no `g` flag), so it is safe to share.
 */
export const NOTE_EXT_RE = /\.(md|yaml|yml)$/i;

/**
 * A note's user-visible title: its basename with the hidden extension stripped.
 * "notes/Grocery List.md" -> "Grocery List". Unlike `fileBasename` this only ever strips the
 * ONE trailing hidden extension, so a name like "My.base.md" titles as "My.base".
 */
export function noteStem(path: string): string {
  return (path.split("/").pop() ?? "").replace(NOTE_EXT_RE, "");
}
