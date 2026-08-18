// app/src/vaultPath.ts
//
// Pure derivation of the vault's display name (basename) from its full
// filesystem path, split out from App.tsx so it can be unit-tested in headless
// Bun without importing the component tree (Solid, CodeMirror, etc — same
// rationale as fileTreeRefresh.ts / pickResult-style extractions).
//
// The status bar shows only the basename (issue #7: a full path doesn't belong
// inline in a field-log line) but App.tsx keeps the full path around alongside
// it for a `title` tooltip + click-to-copy, so the reporter's actual ask — "let
// me see the vault path" — is answered without widening the status bar.

/** Last non-empty path segment — the folder name a user would recognize as "the
 *  vault". Trailing slashes collapse away, and a root-level folder ("/notes")
 *  still yields "notes". Falls back to the original string when there's no
 *  segment to extract (e.g. "" or "/"); callers guard against that rendering
 *  blank (App.tsx does `vaultName() || "vault"`), not this function. */
export function vaultBasename(path: string): string {
    return path.split('/').filter(Boolean).pop() ?? path
}
