// core/src/linkTarget.ts
// Pure wikilink-target rules for notes that share a basename. Shared by core's graph builder and
// the editor's resolver/autocomplete/drop-to-link, so `[[Name]]` resolves to the SAME note in the
// graph as it opens on click, and a link to a duplicate is written path-qualified.
// Ids are note ids: vault-relative paths with the `.md` stripped (`a/x/Name`).

/** The basename of a note id (`a/x/Name` → `Name`). */
export function baseOf(id: string): string {
    return id.slice(id.lastIndexOf('/') + 1)
}

/** The parent directory of a note id (`a/x/Name` → `a/x`, `Name` → ``). */
export function dirOf(id: string): string {
    const i = id.lastIndexOf('/')
    return i === -1 ? '' : id.slice(0, i)
}

/** The deterministic winner between two ids sharing a basename: fewest path segments, then the
 *  smaller path by code-unit order. */
export function preferId(a: string, b: string): string {
    const da = a.split('/').length
    const db = b.split('/').length
    if (da !== db) return da < db ? a : b
    return a < b ? a : b
}

/** The id a bare `[[base]]` resolves to among `ids`, or undefined when none has that basename. */
export function pickByBase(
    base: string,
    ids: Iterable<string>,
): string | undefined {
    let best: string | undefined
    for (const id of ids) {
        if (baseOf(id) !== base) continue
        best = best === undefined ? id : preferId(best, id)
    }
    return best
}

/** The text to put inside `[[…]]` so it resolves to `id`: the bare basename when no other id in
 *  `ids` shares it, else the full id. */
export function linkTargetFor(id: string, ids: Iterable<string>): string {
    const base = baseOf(id)
    for (const other of ids) {
        if (other !== id && baseOf(other) === base) return id
    }
    return base
}
