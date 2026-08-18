/** Unified path utilities for vault path handling.
 *
 *  Browser-safe by construction: no `node:*` imports. `isTempPath` (which needs `node:os`'s
 *  `tmpdir` + `node:path`'s `resolve`) lives in `./tempPath.ts` instead — it's only ever called
 *  from server-only modules (daemon.ts, runRegistry.ts), while the pure helpers below are also
 *  imported straight into the browser bundle (FileTree.tsx, bases/*.tsx, export/baseTable.ts). */

/** Extract the basename (filename without .md or .base extension) from a path. */
export function fileBasename(path: string): string {
    const name = path.split('/').pop() ?? ''
    return name.replace(/\.md$/i, '').replace(/\.base$/i, '')
}

/**
 * The trailing extension the app HIDES from the user in a file name — markdown notes and
 * YAML configs alike, the way Obsidian hides `.md`. The file tree strips it for display and
 * re-applies it when an inline rename commits (`app/src/FileTree.tsx`), and new-note
 * templating derives `{{title}}` from it (`noteStem` below). Shared so those two can't drift
 * — a mismatch is how a note ends up titled "Grocery List.md" in one place and
 * "Grocery List" in another. Stateless (no `g` flag), so it is safe to share.
 */
export const NOTE_EXT_RE = /\.(md|yaml|yml)$/i

/**
 * A note's user-visible title: its basename with the hidden extension stripped.
 * "notes/Grocery List.md" -> "Grocery List". Unlike `fileBasename` this only ever strips the
 * ONE trailing hidden extension, so a name like "My.base.md" titles as "My.base".
 */
export function noteStem(path: string): string {
    return (path.split('/').pop() ?? '').replace(NOTE_EXT_RE, '')
}
