import { parse } from 'yaml'
import { AppError } from '../error'
import { FRONTMATTER_REGEX, mutateFrontmatter } from '../frontmatter'
import { normalizeSource } from './sourceSpec'
import { isValidType } from './types'

/**
 * Rewrite a `type: base` note's legacy `views:` list into the flat single-view spelling, so every
 * later write lands on a plain top-level key. A base has exactly ONE view; files written before
 * that carry it as `views: [{ type, name, … }]`. Returns `md` unchanged when there is no
 * `views:` key. The rewrite parses to the same config `parseBaseFile` reads from the original:
 *   - the entry's `type` becomes `view` (the entry's kind always beat the `view:` shorthand)
 *   - `name` is dropped (it only labelled a view tab)
 *   - `filters` ANDs onto the top-level `filters` (the two always combined that way)
 *   - `source` replaces the top-level `source` (the entry's always won), written in object form
 *     so its own `from`/`where`/`ref` travel with it; the top-level ones it displaces go
 *   - every other key is copied up unless the top level already sets it (flat keys always won)
 * Throws when the list holds more than one view — those have to be split into separate bases
 * (`bismuth base validate` says so) rather than silently dropped.
 */
export function flattenBaseViews(md: string): string {
    const m = md.match(FRONTMATTER_REGEX)
    if (!m) return md
    let data: Record<string, unknown>
    try {
        data = (parse(m[1] ?? '') ?? {}) as Record<string, unknown>
    } catch {
        return md
    }
    if (data.type !== 'base' || !('views' in data)) return md
    const views = Array.isArray(data.views) ? data.views : []
    if (views.length > 1)
        throw new AppError(
            'BASE_VIEWS_FORMAT_ERROR',
            `this base declares ${views.length} views, but a base has one view now — move each extra view into its own base whose \`source: base\` + \`ref:\` points at this one, then remove it from \`views:\``,
        )
    const entry =
        views[0] && typeof views[0] === 'object'
            ? (views[0] as Record<string, unknown>)
            : {}
    return mutateFrontmatter(md, (doc, top) => {
        const set = (k: string, v: unknown) => {
            if (doc.set) doc.set(k, v)
            else top[k] = v
        }
        const del = (k: string) => {
            if (doc.delete) doc.delete(k)
            else delete top[k]
        }
        for (const [k, v] of Object.entries(entry)) {
            if (k === 'name' || k === 'from' || k === 'where' || k === 'ref')
                continue
            if (k === 'type') {
                if (isValidType(v)) set('view', v)
            }
            else if (k === 'filters')
                set('filters', top.filters === undefined ? v : { and: [top.filters, v] })
            else if (k === 'source') {
                const spec = normalizeSource(v, entry)
                if (!spec) continue
                set('source', spec)
                for (const s of ['from', 'where', 'ref']) del(s)
            } else if (!(k in top)) set(k, v)
        }
        del('views')
        return { keep: true, result: '' }
    })
}
