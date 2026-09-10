// Value-stable identity for a re-resolved ViewResult.
//
// Every server revalidation re-runs `/rows` + `runView`, producing brand-new group and
// row OBJECTS even when the underlying data is unchanged. Solid's `<For>` keys by object
// IDENTITY, so those fresh objects unmount→remount every card/row in the view — the whole
// card grid repaints and the masonry reflows. That full repaint is the "flickery/reloady"
// feel on a task status change: toggling one checkbox writes the file, the SSE version
// bumps, the base re-resolves, and all cards blink even though only one changed.
//
// reconcileViewResult diffs the freshly computed result against the PREVIOUS one and reuses
// the prior object reference for any group/row that is byte-identical. `<For>` then sees the
// same references and preserves their DOM — only genuinely changed/added/removed rows touch
// the DOM. Pure (no Solid, no I/O) so it's unit-tested in isolation; BaseView feeds it the
// memo's previous value via `createMemo((prev) => …)`.
import type {
    Row,
    ViewResult,
    ResultGroup,
} from '../../../core/src/bases/types'

/** Stable key for a row across re-resolves. Tasks (note carries a numeric `line`) are keyed
 *  by `path` + DESCRIPTION — NOT `path:line`. Completing a task rewrites its source note and
 *  SINKS the done item to the bottom (taskReorder), which RENUMBERS every task below it. A
 *  `path:line` key would then change for all those siblings, so reconcileRows couldn't match
 *  them → `<For>` unmounts+remounts every task under the one you checked — the "whole list
 *  reloads" flash. The description is stable across that renumbering. Identical descriptions in
 *  one note collide harmlessly: reconcileRows matches them positionally and rowsEqual still
 *  gates reuse, so an ambiguous key can't reuse a wrong row. Non-task rows stay keyed by path. */
export function rowKey(row: Row): string {
    const note = row.note as
        { line?: unknown; description?: unknown } | undefined
    if (note && typeof note.line === 'number') {
        const desc =
            typeof note.description === 'string' && note.description
                ? note.description
                : String(note.line)
        return `${row.file.path} ${desc}`
    }
    return row.file.path
}

/** The file fields a view actually renders — name/path/folder/ext + tags/links. The volatile
 *  stat fields (mtime/ctime/size) are deliberately EXCLUDED: a body-only edit (e.g. ticking a
 *  task inside a card) bumps mtime but changes nothing a view displays except the note body,
 *  which BodyCard re-reads in place (it subscribes to SSE). Including mtime here would give the
 *  edited row a fresh identity and remount its card on every keystroke-driven save — the exact
 *  flicker we're removing. Trade-off: a view that surfaces `file.mtime` as a column shows a
 *  slightly stale timestamp until the row changes structurally; that's rare and benign. */
function fileIdentity(f: Row['file']): unknown {
    return {
        name: f.name,
        path: f.path,
        folder: f.folder,
        ext: f.ext,
        tags: f.tags,
        links: f.links,
    }
}

/** The note fields that matter to identity — everything EXCEPT `line`. `line` is a positional
 *  artifact, not content a view renders: a task list shows the description/status/dates, never
 *  the line number. It's also VOLATILE — completing a task sinks it to the bottom of its note
 *  and renumbers the survivors (see rowKey). Including `line` here would give every renumbered
 *  survivor a fresh identity and remount it on a sibling's toggle — the exact flicker rowKey
 *  already guards against. So a task that only moved lines stays "equal" and keeps its DOM. */
function noteIdentity(note: Row['note']): unknown {
    if (!note || typeof note !== 'object') return note
    const { line: _line, ...rest } = note as Record<string, unknown>
    return rest
}

/** Comparison of the parts a view renders. Any change a view can SHOW — a flipped status char,
 *  an edited description, a changed frontmatter prop or formula value, a new tag/link — yields a
 *  fresh identity so that one row repaints; an unchanged row keeps its old reference (and its
 *  DOM). Rows are small plain JSON from the same code path each resolve, so key order is
 *  deterministic. (Volatile fields excluded: stat fields — see fileIdentity; task line — see
 *  noteIdentity.) */
export function rowsEqual(a: Row, b: Row): boolean {
    if (a === b) return true
    return (
        JSON.stringify(fileIdentity(a.file)) ===
            JSON.stringify(fileIdentity(b.file)) &&
        JSON.stringify(noteIdentity(a.note)) ===
            JSON.stringify(noteIdentity(b.note)) &&
        JSON.stringify(a.formula) === JSON.stringify(b.formula)
    )
}

/** Reconcile a freshly resolved row list against the previous one, reusing prior references
 *  for unchanged rows. Returns the PREVIOUS array reference verbatim when nothing changed at
 *  all (same length, order, and every row reused) so callers can cheaply reuse the enclosing
 *  group object too. */
export function reconcileRows(prev: Row[] | undefined, next: Row[]): Row[] {
    if (!prev || prev.length === 0) return next
    // Bucket prior rows by key — a LIST per key, since keys can repeat (two tasks with the same
    // description in one note). Matches are consumed positionally so duplicate keys map to
    // DISTINCT prior objects instead of all collapsing onto one shared reference (which would
    // hand `<For>` duplicate identities — one row would silently drop out).
    const byKey = new Map<string, Row[]>()
    for (const r of prev) {
        const k = rowKey(r)
        const bucket = byKey.get(k)
        if (bucket) bucket.push(r)
        else byKey.set(k, [r])
    }
    let allSame = prev.length === next.length
    const out = next.map((r, i) => {
        const bucket = byKey.get(rowKey(r))
        if (bucket) {
            const j = bucket.findIndex(old => rowsEqual(old, r))
            if (j >= 0) {
                const old = bucket.splice(j, 1)[0] // consume so a later dup can't reuse it again
                // Keep the prior reference so `<For>` preserves the DOM (no remount/flash), but refresh
                // the VOLATILE positional handles in place: `note.line` and `Row.index` are both
                // "where is this row right now", not content a view renders, so rowsEqual deliberately
                // ignores both (a task that only moved lines, or an inline-base row that only shifted
                // position when a sibling above it was removed, is still "equal" — see noteIdentity).
                // Callers still address a row BY one of these handles (task toggles write `note.line`;
                // rowUpdate/rowDelete write `Row.index`), so a stale one targets the WRONG source
                // row/line once a sibling sinks + renumbers or is deleted and the rest shift up. Safe
                // to mutate: the prior object isn't the live cached resolve (that's the fresh `r`), and
                // neither field is reactive or rendered, so the patch triggers no re-render.
                const oNote = old.note as { line?: unknown } | undefined
                const rNote = r.note as { line?: unknown } | undefined
                if (
                    oNote &&
                    rNote &&
                    typeof rNote.line === 'number' &&
                    oNote.line !== rNote.line
                )
                    oNote.line = rNote.line
                if (typeof r.index === 'number' && old.index !== r.index)
                    old.index = r.index
                // `Row.derived` is the third handle of exactly this kind: it says which note.*
                // keys a normalizer FILLED IN, and a write strips exactly those. Two rows whose
                // notes are byte-identical can still carry DIFFERENT records — a stored column
                // whose value equals the fill it would have received (a user's own
                // `priority: none`) normalizes to the same note either way. Reuse then keeps the
                // stale record, and the next write strips a column the user actually stores.
                // Deliberately NOT part of rowsEqual: comparing it would give the row a fresh
                // identity and remount it, which is the flicker rowsEqual exists to prevent.
                if (r.derived && old.derived !== r.derived)
                    old.derived = r.derived
                if (old !== prev[i]) allSame = false // reused, but reordered
                return old
            }
        }
        allSame = false
        return r
    })
    return allSame ? prev : out
}

/** Reconcile a whole ViewResult: reuse each group object whose rows are unchanged, and within
 *  each group reuse unchanged row objects. `columns`/`summaries`/`view` come straight from the
 *  fresh result (cheap scalars/short arrays — no identity churn that matters to `<For>`). */
export function reconcileViewResult(
    prev: ViewResult | undefined,
    next: ViewResult,
): ViewResult {
    if (!prev) return next
    const prevByKey = new Map<string, ResultGroup>()
    for (const g of prev.groups) prevByKey.set(g.key, g)
    const groups = next.groups.map(ng => {
        const pg = prevByKey.get(ng.key)
        if (!pg) return ng
        const rows = reconcileRows(pg.rows, ng.rows)
        // Group fully unchanged → reuse the prior group object so `<For each={groups}>` keeps it.
        return rows === pg.rows ? pg : { key: ng.key, rows }
    })
    return {
        view: next.view,
        columns: next.columns,
        groups,
        summaries: next.summaries,
    }
}
