import { getFileAccess, type FileStat } from './fileAccess'
import { getParsedNote, getParsedNotes, type ParsedNote } from './parsedNotes'
import { pathParts } from './vault'
import type { FileMeta, Row } from './bases/types'
import { fillBacklinks } from './bases/fileLinks'
import { isCompanionable, isTreeListedName, companionPathFor, inkSidecarFor } from './fileKinds'
import { mapWithConcurrency } from './concurrency'
import { baseNameOf, isBasePath } from './bases/baseFile'

function fileMeta(
    rel: string,
    st: FileStat | null,
    tags: string[],
    links: string[],
    embeds: string[],
): FileMeta {
    const { name, ext, folder } = pathParts(rel)

    // Use file stats if available (null when the file was deleted since the list).
    let size = 0,
        ctime = 0,
        mtime = 0
    if (st) {
        size = st.size
        ctime = st.birthtimeMs || st.ctimeMs
        mtime = st.mtimeMs
    }

    return {
        name,
        basename: name,
        path: rel,
        folder,
        ext,
        size,
        ctime,
        mtime,
        tags,
        links,
        embeds,
        backlinks: [],
    }
}

/** Build the single feed Row for one parsed note. Shared by the full-vault build and the
 *  incremental patch so a patched row is byte-identical to a rebuilt one. The tag and link
 *  arrays are copied (the cached note's are frozen); `note` is the cached frontmatter object
 *  itself, frozen, so a consumer that tried to edit it would throw instead of corrupting the
 *  cache. The freeze is shallow: nested values inside `note` are shared with the cache and must
 *  not be mutated. */
function rowFor(p: ParsedNote): Row {
    return {
        file: fileMeta(p.rel, p.stat, [...p.tags], [...p.links], [...p.embeds]),
        note: p.data as Row['note'],
        formula: {},
    }
}

export async function buildVaultRows(root: string): Promise<Row[]> {
    const { listMarkdown } = await getFileAccess()
    // Parsed notes come from the shared cache (a note deleted since the listing is skipped);
    // its stat is the one the cache validated against, so there is no second stat loop.
    const notes = await getParsedNotes(root, await listMarkdown(root))
    const rows = notes.map(rowFor)
    // Backlinks span the whole vault, so they are set after every row exists, and again on
    // every patch below: an edit to one note changes the backlinks of the notes it links to.
    fillBacklinks(rows)
    return rows
}

/** Generated sidecars that never stand as rows of their own: a drawing's export
 *  (`x.draw.png`, `x.draw.pdf`). */
const isExportSidecar = (rel: string) => rel.endsWith('.draw.png') || rel.endsWith('.draw.pdf')

/**
 * The rows of a `source: files` base: every file the sidebar lists (notes, images, PDFs,
 * drawings, sheets, bases), the way an Obsidian base lists the files Obsidian knows. A file of
 * any other kind (a `LICENSE`, an audio file) is no row. A note is its ordinary row; any other
 * file gets a row whose `file.ext`, `file.size` and timestamps are its own. An image's or PDF's
 * companion note `<file>.md` is folded into the file's row (its frontmatter is the row's
 * properties, its tags and links the row's), so a companion with its binary present is not a row
 * of its own; neither is an ink sidecar `<file>.draw` or a drawing export. Backlinks are filled
 * across the whole set, so an image embedded by a note lists that note.
 *
 * `noteRows` is the vault notes feed (`buildVaultRows`, or its server cache). Its rows are copied,
 * never mutated: the backlinks here differ from the notes-only feed's.
 */
export async function buildFileRows(root: string, noteRows: readonly Row[]): Promise<Row[]> {
    const fa = await getFileAccess()
    const all = (await fa.listFiles(root))
        .filter(rel => isTreeListedName(rel) && !isExportSidecar(rel))
        .sort()
    const notes = new Map(noteRows.map(r => [r.file.path, r] as const))
    // A companion or ink sidecar hides only while its binary is present; an orphaned companion
    // is an ordinary note row.
    const hidden = new Set<string>()
    for (const rel of all) {
        if (!isCompanionable(rel)) continue
        hidden.add(companionPathFor(rel))
        hidden.add(inkSidecarFor(rel))
    }
    const others = all.filter(
        rel => !rel.toLowerCase().endsWith('.md') && !hidden.has(rel),
    )
    const stats = new Map<string, FileStat | null>()
    await mapWithConcurrency(others, 32, async rel => {
        stats.set(rel, await fa.statNote(root, rel).catch(() => null))
    })
    const rows: Row[] = []
    for (const rel of all) {
        if (hidden.has(rel)) continue
        if (rel.toLowerCase().endsWith('.md')) {
            const r = notes.get(rel)
            if (r) rows.push({ ...r, file: { ...r.file } })
            continue
        }
        const companion = isCompanionable(rel) ? notes.get(companionPathFor(rel)) : undefined
        const meta = fileMeta(
            rel,
            stats.get(rel) ?? null,
            companion ? [...companion.file.tags] : [],
            companion ? [...companion.file.links] : [],
            companion ? [...(companion.file.embeds ?? [])] : [],
        )
        // An attachment's name keeps its extension (`photo.png`), as Obsidian shows it, so
        // `photo.png` and `photo.jpg` stay apart; `file.basename` is the name without it.
        const slash = rel.lastIndexOf('/')
        meta.name = slash >= 0 ? rel.slice(slash + 1) : rel
        // A base's extension is `base` (its file ends `.base.jsonl`), so a filter written
        // against Obsidian's `.base` files (`file.ext == "base"`) finds it.
        if (isBasePath(rel)) {
            meta.ext = 'base'
            meta.basename = baseNameOf(rel)
        }
        rows.push({ file: meta, note: companion?.note ?? {}, formula: {} })
    }
    fillBacklinks(rows)
    return rows
}

/**
 * Incrementally patch the cached vault rows feed for the changed `paths` instead of
 * dropping it and re-walking + re-parsing the whole vault on the next base render (the
 * ~400ms cold cost paid after every note edit — the single biggest reason a base "loads
 * slowly" right after you type). Mirrors updateSearchIndex(): re-parse only the changed
 * notes and splice them into the cached Row[] in place, keeping every other row untouched.
 *
 * An edited note is replaced in place and a deleted one is spliced out, both order-preserving,
 * so a content edit (the common case) yields a feed byte-identical to a full rebuild. A
 * BRAND-NEW note takes a second path: it has no inferable position, so the vault is re-LISTED
 * (a dirent walk, no file reads) to recover the authoritative order and the cached rows are
 * reused around it — still parsing only what changed.
 *
 * Falls back to a full invalidate when there is nothing safe to patch: no cached feed yet,
 * the listing failed, or the listing turned up a note the cached feed has never seen.
 */
export async function patchVaultRows(
    root: string,
    paths: string[],
    cache: {
        peek(): Row[] | null
        patch(mutate: (rows: Row[]) => void): boolean
        invalidate(): void
    },
): Promise<void> {
    const current = cache.peek()
    const mdPaths = paths.filter(p => p.endsWith('.md'))
    if (!current || mdPaths.length === 0) {
        // Nothing cached (next read builds fresh) or no note changed → drop only if there
        // is a stale value that a non-.md path shouldn't have touched (there isn't). No-op.
        if (!current && mdPaths.length) cache.invalidate()
        return
    }
    const known = new Set(current.map(r => r.file.path))
    const { listMarkdown } = await getFileAccess()
    // Re-parse each changed note (null row = gone from disk).
    const reparsed = await Promise.all(
        mdPaths.map(async (rel): Promise<{ rel: string; row: Row | null }> => {
            const note = await getParsedNote(root, rel)
            return { rel, row: note ? rowFor(note) : null } // null = unreadable / removed
        }),
    )
    const byPath = new Map(reparsed.map(({ rel, row }) => [rel, row] as const))
    // A new note (present on disk, absent from the feed) has no position we can infer from
    // the cached array alone. Dropping the whole feed here is what made a JUST-CREATED base
    // load slowly: creating the base note invalidated the feed, and the base's very next
    // /rows request paid a full vault walk + a re-parse of EVERY note. Instead, re-LIST the
    // vault — a dirent walk with no file reads — to recover the authoritative order, and
    // reuse every cached row as-is, parsing only the notes that actually changed.
    if (reparsed.some(({ rel, row }) => row !== null && !known.has(rel))) {
        const existing = new Map(current.map(r => [r.file.path, r] as const))
        let next: Row[] | null = []
        try {
            for (const rel of await listMarkdown(root)) {
                const changed = byPath.get(rel)
                if (changed !== undefined) {
                    if (changed !== null) next.push(changed) // new or edited
                    continue // null => deleted since the walk; drop it
                }
                const prev = existing.get(rel)
                // On disk but neither cached nor in this batch — we never saw its event, so the
                // cached feed is missing rows we cannot reconstruct without reading them. Fall
                // back to a full rebuild rather than silently serving an incomplete feed.
                if (!prev) {
                    next = null
                    break
                }
                next.push(prev)
            }
        } catch {
            next = null // couldn't establish order → rebuild next read
        }
        const rebuilt = next
        if (
            rebuilt === null ||
            !cache.patch(rows => {
                rows.length = 0
                rows.push(...rebuilt)
                fillBacklinks(rows)
            })
        ) {
            cache.invalidate()
        }
        return
    }
    const applied = cache.patch(rows => {
        // Walk once: replace edited rows in place, drop deleted ones, preserving order.
        for (let i = rows.length - 1; i >= 0; i--) {
            const next = byPath.get(rows[i].file.path)
            if (next === undefined) continue // unchanged note
            if (next === null)
                rows.splice(i, 1) // deleted
            else rows[i] = next // edited → in-place replace
        }
        fillBacklinks(rows)
    })
    if (!applied) cache.invalidate() // raced with an invalidation → rebuild next read
}
