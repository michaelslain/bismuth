// The write handle for an inline ```query view over `ref: "[[Base]]"`. Reads resolve the ref
// server-side the way a wikilink does (exact vault path, then basename), so the write handle
// has to land on the SAME file — `refToPath` alone is root-only and would target (or create) a
// nonexistent root `List.md` while the rows come from `reading/List.md`. No framework imports.
import { pickRefPath } from '../../../core/src/bases/sourceSpec'

/** `filePaths` are vault-relative file paths (`.md` and `.base.jsonl` are candidates). One shared
 *  resolver with the server's reads: `pickRefPath`. */
export function resolveQueryBasePath(
    ref: string | undefined,
    filePaths: Iterable<string>,
): string {
    return pickRefPath(ref, filePaths)
}
