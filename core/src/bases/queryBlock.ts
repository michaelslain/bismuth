import type { QueryBlock, ViewType, SourceSpec, SortSpec } from './types'
import { VIEW_TYPES } from './types'

/**
 * Parse a flat ```query block body into a QueryBlock spec.
 *
 * A query references a base or runs a task query — it does NOT iterate notes itself
 * (that is a base's job, via `source: notes`). Keys:
 *   of:    [[Base]]                  -> render that base (follows the base's own source)
 *   tasks: <dsl>                     -> a task query (Tasks DSL; empty = all)
 *   from:  [[Base]]                  -> scope the task query to that base's notes
 *   view:  table|cards|list|kanban|map|calendar|flashcards   (default table; legacy alias `as:`)
 *   where: <expr>                    -> per-view filter
 *   sort:  <property>[ desc][, <property>[ desc]...]   -> sort keys, applied in order
 *   group: <field>
 *   limit: <n>
 *
 * `of:` and `tasks:` are mutually exclusive; if both are present, `of:` wins.
 * With neither, source is undefined and the host renders an empty state.
 */
export function parseQueryBlock(src: string): QueryBlock {
    const kv: Record<string, string> = {}
    const lines = src.split('\n')
    const indentOf = (s: string): number =>
        s.length - s.replace(/^\s*/, '').length
    for (let idx = 0; idx < lines.length; idx++) {
        const raw = lines[idx]
        const l = raw.trim()
        if (!l) continue
        const i = l.indexOf(':')
        if (i <= 0) continue
        const key = l.slice(0, i).trim()
        let val = l.slice(i + 1).trim()
        // YAML block scalar (`tasks: |-`): gather the following more-indented lines as a multi-LINE
        // value. The Tasks DSL needs `sort by …` on its own line (translateTaskDsl only honors a sort
        // that is a whole line, never inside an ` AND `-joined one), which a single-line value can't carry.
        if (/^[|>][+-]?$/.test(val)) {
            const keyIndent = indentOf(raw)
            const collected: string[] = []
            while (idx + 1 < lines.length) {
                const nx = lines[idx + 1]
                if (nx.trim() === '') {
                    collected.push('')
                    idx++
                    continue
                }
                if (indentOf(nx) <= keyIndent) break // dedent to the key's level ends the block
                collected.push(nx)
                idx++
            }
            const bodyIndents = collected.filter(s => s.trim()).map(indentOf)
            const strip = bodyIndents.length ? Math.min(...bodyIndents) : 0
            val = collected
                .map(s => s.slice(strip))
                .join('\n')
                .replace(/\n+$/, '')
        }
        kv[key] = val
    }

    let source: SourceSpec | undefined
    if (kv.of) {
        source = { kind: 'base', ref: kv.of }
    } else if ('tasks' in kv) {
        source = { kind: 'tasks' }
        if (kv.tasks) source.where = kv.tasks
        if (kv.from) source.from = kv.from
    }

    // `view:` is the current render-mode key; `as:` is the legacy spelling. A tasks
    // query defaults to a checkbox list; everything else to a table.
    const mode = kv.view ?? kv.as
    const as = (VIEW_TYPES as string[]).includes(mode)
        ? (mode as ViewType)
        : source?.kind === 'tasks'
          ? 'list'
          : 'table'
    // `sort: note.due desc, note.priority` -> a SortSpec per comma-separated key, each
    // with an optional trailing desc/reverse. A key is words separated by whitespace;
    // after stripping ONE trailing direction word, exactly one word must remain, and it
    // must not itself be a direction word — otherwise the whole key is malformed and
    // DROPPED rather than kept as a spec that sorts by a field that cannot exist:
    //   "desc"                  -> no property at all (just the direction word)
    //   "note.due desc reverse" -> two direction words; which one did the author mean?
    const parseSortKey = (part: string): SortSpec | null => {
        const words = part.split(/\s+/).filter(Boolean)
        if (words.length === 0) return null
        const isDir = (w: string) => /^(desc|reverse)$/i.test(w)
        const last = words[words.length - 1]
        const direction = isDir(last) ? 'DESC' : 'ASC'
        const propWords = isDir(last) ? words.slice(0, -1) : words
        if (propWords.length !== 1 || isDir(propWords[0])) return null
        return { property: propWords[0], direction }
    }
    const parsedSort = kv.sort
        ? kv.sort
              .split(',')
              .map(part => part.trim())
              .filter(Boolean)
              .map(parseSortKey)
              .filter((s): s is SortSpec => s !== null)
        : []
    const sort: SortSpec[] | undefined = parsedSort.length ? parsedSort : undefined

    return {
        source,
        as,
        where: kv.where || undefined,
        sort,
        group: kv.group || undefined,
        limit: kv.limit ? Number(kv.limit) : undefined,
    }
}
