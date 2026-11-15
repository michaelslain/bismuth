import { splitWikilinkInner } from '../wikilinkParts'

export interface Link {
    __link: true
    path: string
    display?: string
}

export function isLink(v: unknown): v is Link {
    return !!v && typeof v === 'object' && (v as Link).__link === true
}

export function truthy(v: unknown): boolean {
    if (v === null || v === undefined) return false
    if (typeof v === 'boolean') return v
    if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
    if (typeof v === 'string') return v.length > 0
    if (Array.isArray(v)) return v.length > 0
    if (v instanceof Date) return !Number.isNaN(v.getTime())
    return true
}

/** The target of a value written as a wikilink (`"[[Notes/People|them]]"` → `Notes/People`), the
 *  way a frontmatter property holds a link; null for any other text. */
function wikilinkTarget(v: unknown): string | null {
    if (typeof v !== 'string') return null
    const m = /^\s*\[\[([^\]]+)\]\]\s*$/.exec(v)
    return m ? splitWikilinkInner(m[1]).target || null : null
}

/** Two link targets name the same note: equal, or equal once the folder and `.md` are dropped,
 *  since `[[People]]` and `[[Categories/People]]` both resolve to `Categories/People.md`. */
function sameTarget(a: string, b: string): boolean {
    const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '')
    return a === b || base(a) === base(b)
}

function linkEqualsValue(l: Link, v: unknown): boolean {
    if (l.path === v || (l.display !== undefined && l.display === v)) return true
    const t = wikilinkTarget(v)
    return t !== null && sameTarget(l.path, t)
}

/** The note a file value stands for, compared like a link: a file's metadata (`file`, which has a
 *  `path` and `tags`), or an embedding note's `this`, which carries its file under `file`. In
 *  Obsidian `this` in an embedded base IS the host file, so `list(loc).contains(this)` matches a
 *  property holding `"[[Kyoto]]"` on the Kyoto note. Null for any other value. */
function filePathOf(v: unknown): string | null {
    if (!v || typeof v !== 'object' || Array.isArray(v) || v instanceof Date || isLink(v)) return null
    const o = v as Record<string, unknown>
    if (typeof o.path === 'string' && Array.isArray(o.tags)) return o.path
    const f = o.file as Record<string, unknown> | undefined
    if (f && typeof f === 'object' && typeof f.path === 'string') return f.path
    return null
}

export function looseEquals(a: unknown, b: unknown): boolean {
    if (a instanceof Date && b instanceof Date)
        return a.getTime() === b.getTime()
    const fa = filePathOf(a)
    const fb = filePathOf(b)
    if (fa !== null || fb !== null) {
        if (fa !== null && fb !== null) return fa === fb
        const path = (fa ?? fb)!
        const other = fa !== null ? b : a
        if (isLink(other)) return sameTarget(path, other.path)
        const t = wikilinkTarget(other)
        return t !== null && sameTarget(path, t)
    }
    if (isLink(a) && isLink(b)) return sameTarget(a.path, b.path)
    if (isLink(a)) return linkEqualsValue(a, b)
    if (isLink(b)) return linkEqualsValue(b, a)
    return a === b
}

export function compare(a: unknown, b: unknown): number {
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    if (typeof a === 'number' && typeof b === 'number') return a - b
    if (a === null || a === undefined)
        return b === null || b === undefined ? 0 : -1
    if (b === null || b === undefined) return 1
    return String(a).localeCompare(String(b))
}

export function toNumber(v: unknown): number {
    if (typeof v === 'number') return v
    if (typeof v === 'string') {
        const n = Number(v)
        return Number.isNaN(n) ? NaN : n
    }
    if (typeof v === 'boolean') return v ? 1 : 0
    if (v instanceof Date) return v.getTime()
    return NaN
}
