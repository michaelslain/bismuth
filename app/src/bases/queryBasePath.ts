// The write handle for an inline ```query view over `ref: "[[Base]]"`. Reads resolve the ref
// server-side the way a wikilink does (exact vault path, then basename), so the write handle
// has to land on the SAME file — `refToPath` alone is root-only and would target (or create) a
// nonexistent root `List.md` while the rows come from `reading/List.md`. No framework imports.
import { pickByBase } from '../../../core/src/linkTarget'
import { refToPath } from '../../../core/src/bases/sourceSpec'

/** `filePaths` are vault-relative file paths (any extension; only `.md` files are candidates).
 *  An exact path match wins, then the basename via `pickByBase`, then the root-only path. */
export function resolveQueryBasePath(
    ref: string | undefined,
    filePaths: Iterable<string>,
): string {
    const exact = refToPath(ref)
    if (!exact) return exact
    const paths = new Set(filePaths)
    if (paths.has(exact)) return exact
    const ids: string[] = []
    for (const p of paths) if (p.endsWith('.md')) ids.push(p.slice(0, -3))
    const hit = pickByBase(exact.replace(/\.md$/, ''), ids)
    return hit === undefined ? exact : `${hit}.md`
}
