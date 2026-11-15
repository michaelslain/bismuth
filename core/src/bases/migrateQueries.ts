// Rewrites legacy ```query blocks (`tasks: <dsl>`) into `tasks:` + `where:` + `sort:`.
// Shared by `bismuth base migrate-queries` and the Obsidian importer.
import { parseQueryBlock } from './queryBlock'
import { looksLikeTaskDsl, translateTaskDsl } from './taskDsl'

export interface FenceMatch {
    from: number // start of the opening delimiter line
    to: number // end of the closing delimiter line (exclusive)
    bodyFrom: number // start of the body, just past the opening line's own newline
    bodyTo: number // end of the body, just before the closing line's own newline
    body: string
}

/** Find every TOP-LEVEL ```query fence in raw markdown text — a live block a rendered
 *  note would actually turn into a BaseView, as opposed to a ```query fence quoted
 *  INSIDE a larger fence to show a worked example (docs/bases/query-block.md does this
 *  throughout, via a ` ````markdown ` wrapper).
 *
 *  editor/queryBlock.ts's own QUERY_FENCE — `/^```query[ \t]*\n([\s\S]*?)\n```/gm` — is
 *  line-anchored but NOT nesting-aware: a 3-backtick "```query" still starts at column 0
 *  of its own line even when it's nested inside a 4-backtick wrapper, so that regex (and
 *  an earlier, non-anchored version of this function) matches — and this tool then
 *  REWRITES — the example instead of leaving it as documentation. CommonMark's actual
 *  rule is that a fence can only be closed by a run of backticks AT LEAST as long as the
 *  one that opened it, which is exactly what lets a longer run safely quote a shorter one
 *  as literal text. This walks the document tracking ONE open fence's backtick count at a
 *  time and applies that rule, so a ```query nested inside a ````-or-longer fence is
 *  correctly read as part of the OUTER fence's body, never as a live block of its own. */
export function findQueryFences(text: string): FenceMatch[] {
    const lines = text.split('\n')
    const lineOffsets: number[] = []
    let offset = 0
    for (const line of lines) {
        lineOffsets.push(offset)
        offset += line.length + 1
    }

    const out: FenceMatch[] = []
    let openLen = 0 // backtick run length of the currently open fence; 0 = not in one
    let openIsQuery = false
    let openStartLine = -1

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (openLen === 0) {
            const m = line.match(/^(`{3,})(.*)$/)
            if (m) {
                openLen = m[1].length
                openIsQuery = m[2].trim() === 'query'
                openStartLine = i
            }
            continue
        }
        // A closing fence is a run of backticks with nothing after but whitespace, AT
        // LEAST as long as the run that opened it — a shorter run (or one followed by
        // other text) is just body content, exactly like inside a real editor.
        const m = line.match(/^(`{3,})\s*$/)
        if (m && m[1].length >= openLen) {
            if (openIsQuery) {
                const bodyFrom =
                    lineOffsets[openStartLine] + lines[openStartLine].length + 1
                const bodyTo = lineOffsets[i] - 1
                out.push({
                    from: lineOffsets[openStartLine],
                    to: lineOffsets[i] + line.length,
                    bodyFrom,
                    bodyTo,
                    body: text.slice(bodyFrom, bodyTo),
                })
            }
            openLen = 0
            openIsQuery = false
        }
    }
    return out
}

/** Locate the `tasks:` key's raw line range in a flat ```query block body — a single
 *  line (`tasks: not done`) or a YAML block scalar (`tasks: |-` + more-indented lines) —
 *  mirroring the block-scalar rule `parseQueryBlock` uses to read the same key. Returns
 *  the [from, to) line indices to splice out, or null when there is no `tasks:` key. */
function findTasksLineRange(
    lines: string[],
): { from: number; to: number } | null {
    const indentOf = (s: string): number =>
        s.length - s.replace(/^\s*/, '').length
    for (let idx = 0; idx < lines.length; idx++) {
        const raw = lines[idx]
        const l = raw.trim()
        if (!l) continue
        const i = l.indexOf(':')
        if (i <= 0) continue
        if (l.slice(0, i).trim() !== 'tasks') continue
        const val = l.slice(i + 1).trim()
        let end = idx
        if (/^[|>][+-]?$/.test(val)) {
            const keyIndent = indentOf(raw)
            while (end + 1 < lines.length) {
                const nx = lines[end + 1]
                if (nx.trim() === '') {
                    end++
                    continue
                }
                if (indentOf(nx) <= keyIndent) break
                end++
            }
        }
        return { from: idx, to: end + 1 }
    }
    return null
}

export interface MigrateBodyOptions {
    /** The caller knows `tasks:` holds Tasks-DSL text (the Obsidian importer reads it out of a
     *  ```tasks fence), so skip the `looksLikeTaskDsl` guess. That guess rejects real DSL text
     *  containing a `.` or opening with a word it does not know (`path includes …`). */
    assumeDsl?: boolean
}

/** Rewrite one ```query block body's legacy `tasks: <dsl>` into `tasks:` + `where:` +
 *  `sort:`, via the same translateTaskDsl shim source.ts applies at read time — with
 *  `liveDates: true`, so a relative date word (`tomorrow`, `in 3 days`, …) is written out
 *  as a live `today()`-relative Bases expression instead of a resolved literal. A
 *  migration runs ONCE; baking today's answer into the file would freeze it forever,
 *  where the un-migrated form re-resolves fresh on every render. Every other line is
 *  left byte-for-byte alone (comments, unrelated keys, ordering).
 *
 *  Returns `{changed: false}` when there's nothing to migrate (no tasks: source, or the
 *  tasks: value is already a Bases expression / empty — i.e. already migrated, which is
 *  what makes running this twice a no-op). Returns `null` — "cannot convert" — in two
 *  cases, both left untouched and reported by the caller rather than guessed at:
 *  - the block already carries its OWN `where:`/`sort:` key: overwriting either would
 *    silently discard a per-view filter or sort a person wrote on purpose, and merging
 *    into it would guess at semantics (source-filter vs view-filter) this tool has no
 *    business guessing.
 *  - a date leaf names a weekday (`due friday`) — `translateTaskDsl({liveDates:true})`
 *    has no live Bases form for that and reports it via `TaskDslTranslation.blocked`
 *    rather than freezing it; this tool honors that the same way.
 *
 *  A `sort by priority` DSL line translates to a `note.priority` SortSpec and IS written
 *  as a modern `sort:` key — the general Bases sort path (query.ts's `compareForSort`)
 *  ranks priority by urgency the same way `applyTaskSort` always did, so this no longer
 *  needs its own refusal. */
export function migrateQueryBody(
    body: string,
    todayIso: string,
    opts?: MigrateBodyOptions,
): {
    body: string
    changed: boolean
    unrecognized?: string[]
    ignored?: string[]
} | null {
    const qb = parseQueryBlock(body)
    if (qb.source?.kind !== 'tasks' || !qb.source.where)
        return { body, changed: false }
    if (!opts?.assumeDsl && !looksLikeTaskDsl(qb.source.where))
        return { body, changed: false }
    if (qb.where !== undefined || qb.sort !== undefined) return null

    const translated = translateTaskDsl(qb.source.where, todayIso, {
        liveDates: true,
    })
    if (translated.blocked) return null

    const range = findTasksLineRange(body.split('\n'))
    if (!range) return { body, changed: false }

    const replacement: string[] = ['tasks:']
    if (translated.where) replacement.push(`where: ${translated.where}`)
    if (translated.sort?.length) {
        const sortStr = translated.sort
            .map(s =>
                s.direction === 'DESC' ? `${s.property} desc` : s.property,
            )
            .join(', ')
        replacement.push(`sort: ${sortStr}`)
    }
    const lines = body.split('\n')
    const next = [
        ...lines.slice(0, range.from),
        ...replacement,
        ...lines.slice(range.to),
    ].join('\n')
    return {
        body: next,
        changed: true,
        unrecognized: translated.unrecognized,
        ignored: translated.ignored,
    }
}
