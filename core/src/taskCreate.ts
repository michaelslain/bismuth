// The write seam for the "+ task" action: resolve a `taskFile` ref (a wikilink, the way the
// docs and settings UI both spell it) against the VAULT, then append a checkbox line to the
// note it names.
//
// Why this exists: `refToPath()` (bases/sourceSpec.ts) turns `[[Anything]]` into `Anything.md`
// AT THE VAULT ROOT and never consults the vault. A base declaring `taskFile: "[[General
// Tasks]]"` whose real note lives at `tasks/general/General Tasks.md` had `+ task` create a
// brand-new `/General Tasks.md` at the root — which then failed the base's own
// `file.inFolder("tasks")` filter, so the task was written, invisible, and unfindable.
import { readNote, writeNote, listMarkdown, fileExists } from './files'
import { pickByBase } from './linkTarget'

/**
 * A taskFile ref (`[[Name]]`, `Name`, `folder/Name`, `folder/Name.md`) → the vault-relative
 * path it names. Pure. `noteIds` are vault note ids (relative paths, `.md` stripped), the
 * shape `listMarkdown` produces after stripping.
 *
 * Resolution order: strip `[[`/`]]`; an EXACT match on the ref among `noteIds` wins (with or
 * without a trailing `.md`); then `pickByBase` (linkTarget.ts) — a bare basename resolves the
 * same way a wikilink does everywhere else in the app, settling a duplicate basename
 * deterministically via `preferId`; else `${ref}.md` names a BRAND-NEW note, which is what a
 * wikilink to a nonexistent note means everywhere else in this app.
 */
export function resolveTaskFilePath(
    ref: string,
    noteIds: Iterable<string>,
): string {
    const bare = ref.replace(/^\[\[/, '').replace(/\]\]$/, '')
    const withoutExt = bare.endsWith('.md') ? bare.slice(0, -3) : bare
    const ids = [...noteIds]
    if (ids.includes(withoutExt)) return `${withoutExt}.md`
    const byBase = pickByBase(withoutExt, ids)
    if (byBase !== undefined) return `${byBase}.md`
    return `${withoutExt}.md`
}

/**
 * Append `- [ ] <body>` to the note `ref` resolves to under `root`, inserting the separating
 * newline only when the file does not already end in one — so appending to a file that ends
 * mid-line does not join onto it, and appending to a normal file does not leave a blank line
 * behind. Creates the note (and any missing parent directories) when the ref resolves to
 * nothing yet. Returns the vault-relative path actually written.
 */
export async function appendTaskLine(
    root: string,
    ref: string,
    body: string,
): Promise<string> {
    const noteIds = (await listMarkdown(root)).map(rel =>
        rel.endsWith('.md') ? rel.slice(0, -3) : rel,
    )
    const path = resolveTaskFilePath(ref, noteIds)
    const text = fileExists(root, path) ? await readNote(root, path) : ''
    const sep = text.length === 0 || text.endsWith('\n') ? '' : '\n'
    await writeNote(root, path, `${text}${sep}- [ ] ${body}\n`)
    return path
}
