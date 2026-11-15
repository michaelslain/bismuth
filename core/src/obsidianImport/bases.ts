// Obsidian bases → Bismuth bases. Pure over VaultText: every `.base` file, every ```base fence,
// every `![[X.base]]` embed and every plain `[[X.base]]` link. No I/O (mobile runs core in-process).
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { serializeBaseJsonl } from '../bases/baseFile'
import { VIEW_TYPES } from '../bases/types'
import { FRONTMATTER_REGEX, mutateFrontmatter } from '../frontmatter'
import type {
    FileEdit,
    ImportContext,
    ReportItem,
    StepResult,
    VaultText,
} from './types'

type Raw = Record<string, unknown>

const SUMMARY_NAMES = [
    'Sum',
    'Average',
    'Min',
    'Max',
    'Count',
    'Empty',
    'Filled',
    'Unique',
]
const GLOBAL_FNS = new Set([
    'if',
    'number',
    'list',
    'min',
    'max',
    'now',
    'today',
    'date',
    'duration',
    'link',
    'random',
])
const METHODS = new Set([
    'toString',
    'isTruthy',
    'containsAny',
    'containsAll',
    'hasTag',
    'hasLink',
    'inFolder',
    'hasProperty',
    'asLink',
    'asFile',
    'toFixed',
    'round',
    'floor',
    'ceil',
    'abs',
    'isEmpty',
    'lower',
    'upper',
    'trim',
    'title',
    'contains',
    'startsWith',
    'endsWith',
    'replace',
    'slice',
    'split',
    'reverse',
    'matches',
    'join',
    'unique',
    'sort',
    'flat',
    'map',
    'filter',
    'reduce',
    'format',
    'date',
    'plus',
    'minus',
])
export const KNOWN_FUNCTIONS = GLOBAL_FNS
export const KNOWN_METHODS = METHODS
export const KNOWN_SUMMARIES = SUMMARY_NAMES

type ViewConf = { name: string; conf: Raw }
type ParsedBase = {
    path: string
    global: Raw
    views: ViewConf[]
}

const isObj = (v: unknown): v is Raw =>
    !!v && typeof v === 'object' && !Array.isArray(v)

const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const stem = (p: string) => p.replace(/\.base$/, '')
const joinPath = (d: string, f: string) => (d ? `${d}/${f}` : f)

function safeName(s: string): string {
    return s.replace(/[\\/:*?"<>|]/g, '-').trim()
}

// ---- expressions ----------------------------------------------------------------------

function exprStrings(node: unknown, out: string[] = []): string[] {
    if (typeof node === 'string') out.push(node)
    else if (Array.isArray(node)) node.forEach(n => exprStrings(n, out))
    else if (isObj(node)) Object.values(node).forEach(n => exprStrings(n, out))
    return out
}

/** Names of functions in `expr` that Bismuth does not define. */
function unsupportedIn(expr: string): string[] {
    const bare = expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    const found: string[] = []
    for (const m of bare.matchAll(/(\.)?\b([A-Za-z_]\w*)\s*\(/g)) {
        const known = m[1] ? METHODS.has(m[2]) : GLOBAL_FNS.has(m[2])
        if (!known) found.push(m[2])
    }
    return found
}

/** `file.hasTag("a")` → `file.hasTag("a", "a/b")` over the vault's tags. */
function expandHasTag(expr: string, tags: string[], changed: string[]): string {
    return expr.replace(/file\.hasTag\(([^)]*)\)/g, (whole, args: string) => {
        const lits = [...args.matchAll(/(["'])((?:(?!\1).)*)\1/g)]
        if (lits.length === 0) return whole
        const q = lits[0][1]
        const names = lits.map(l => l[2])
        const all = [...names]
        for (const n of names)
            for (const t of tags)
                if (t.startsWith(n + '/') && !all.includes(t)) all.push(t)
        if (all.length === names.length) return whole
        const out = `file.hasTag(${all.map(n => q + n + q).join(', ')})`
        changed.push(`${whole} -> ${out}`)
        return out
    })
}

function mapExprs(node: unknown, fn: (s: string) => string): unknown {
    if (typeof node === 'string') return fn(node)
    if (Array.isArray(node)) return node.map(n => mapExprs(n, fn))
    if (isObj(node))
        return Object.fromEntries(
            Object.entries(node).map(([k, v]) => [k, mapExprs(v, fn)]),
        )
    return node
}

// ---- parsing one base ------------------------------------------------------------------

function parseBase(
    path: string,
    text: string,
    items: ReportItem[],
): ParsedBase | null {
    let doc: unknown
    try {
        doc = parseYaml(text)
    } catch (e) {
        items.push({
            section: 'decide',
            area: 'bases',
            path,
            detail: `base file does not parse as YAML, left as written: ${(e as Error).message.split('\n')[0]}`,
        })
        return null
    }
    return fromDoc(path, doc ?? {}, items)
}

function fromDoc(path: string, doc: unknown, items: ReportItem[]): ParsedBase | null {
    if (!isObj(doc)) {
        items.push({
            section: 'decide',
            area: 'bases',
            path,
            detail: 'base is not a YAML mapping, left as written',
        })
        return null
    }
    const global: Raw = {}
    for (const k of ['filters', 'formulas', 'properties'])
        if (doc[k] !== undefined) global[k] = doc[k]
    if (isObj(doc.summaries) && Object.keys(doc.summaries).length > 0) {
        items.push({
            section: 'lossy',
            area: 'bases',
            path,
            detail: `custom summaries dropped: ${Object.keys(doc.summaries).join(', ')}`,
        })
    }
    const rawViews = Array.isArray(doc.views) ? doc.views : []
    const views: ViewConf[] = rawViews.filter(isObj).map((v, i) => ({
        name: typeof v.name === 'string' && v.name.trim() ? v.name : `View ${i + 1}`,
        conf: v,
    }))
    if (views.length === 0) views.push({ name: 'View 1', conf: { type: 'table' } })
    return { path, global, views }
}

// ---- building a flat config ------------------------------------------------------------

function flatConfig(
    b: ParsedBase,
    v: ViewConf,
    opts: { source: 'notes' } | { ref: string },
    tags: string[],
    items: ReportItem[],
    where: string,
): Raw {
    const out: Raw = { type: 'base' }
    if ('ref' in opts) {
        out.source = 'base'
        out.ref = opts.ref
    } else out.source = 'notes'

    const g = b.global.filters
    const own = v.conf.filters
    let filters: unknown
    if (g !== undefined && own !== undefined) filters = { and: [g, own] }
    else filters = g ?? own
    const formulas = b.global.formulas
    const note = (detail: string, section: ReportItem['section'] = 'decide') =>
        items.push({ section, area: 'bases', path: where, detail })

    const checked = new Set<string>()
    for (const e of [...exprStrings(filters), ...exprStrings(formulas)]) {
        if (checked.has(e)) continue
        checked.add(e)
        const bad = [...new Set(unsupportedIn(e))]
        if (bad.length)
            note(`Obsidian-only ${bad.join(', ')} in \`${e}\`; Bismuth does not define it, so the expression evaluates to nothing`)
    }
    const changed: string[] = []
    if (filters !== undefined)
        out.filters = mapExprs(filters, s => expandHasTag(s, tags, changed))
    if (formulas !== undefined)
        out.formulas = mapExprs(formulas, s => expandHasTag(s, tags, changed))
    if (b.global.properties !== undefined) out.properties = b.global.properties
    for (const c of changed)
        note(`${c}; a tag created later is not matched`, 'lossy')

    const type = typeof v.conf.type === 'string' ? v.conf.type : 'table'
    if ((VIEW_TYPES as string[]).includes(type)) out.view = type
    else {
        out.view = 'table'
        note(`Obsidian layout "${type}" has no Bismuth equivalent, written as a table`)
    }
    for (const [k, val] of Object.entries(v.conf)) {
        if (k === 'name' || k === 'type' || k === 'filters') continue
        if (k === 'summaries' && isObj(val)) {
            const kept: Raw = {}
            for (const [prop, s] of Object.entries(val)) {
                if (typeof s === 'string' && SUMMARY_NAMES.includes(s)) kept[prop] = s
                else note(`summary "${String(s)}" on ${prop} dropped; Bismuth computes only ${SUMMARY_NAMES.join(', ')}`, 'lossy')
            }
            if (Object.keys(kept).length) out.summaries = kept
            continue
        }
        out[k] = val
    }
    if (out.view === 'map' && 'coordinates' in v.conf)
        note(`map coordinates property ${JSON.stringify(v.conf.coordinates)} is not read; rows need separate numeric lat and lng properties`, 'lossy')
    return out
}

// ---- fences ----------------------------------------------------------------------------

type Seg = { fence: boolean; info: string; text: string }

/** Split text into alternating prose and fenced-block segments (fence lines included). */
function splitFences(text: string): Seg[] {
    const lines = text.split('\n')
    const segs: Seg[] = []
    let cur: string[] = []
    let open: { ch: string; len: number; info: string } | null = null
    const flush = (fence: boolean, info = '') => {
        if (cur.length) segs.push({ fence, info, text: cur.join('') })
        cur = []
    }
    lines.forEach((line, i) => {
        const nl = i < lines.length - 1 ? '\n' : ''
        const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
        if (!open) {
            if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
                flush(false)
                open = { ch: m[1][0], len: m[1].length, info: m[2].trim() }
            }
            cur.push(line + nl)
        } else {
            cur.push(line + nl)
            if (m && m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === '') {
                const info = open.info
                open = null
                flush(true, info)
            }
        }
    })
    flush(open !== null, (open as { info: string } | null)?.info ?? '')
    return segs
}

/** Apply `fn` to the parts of `line` outside inline code spans. */
function outsideCode(text: string, fn: (s: string) => string): string {
    const parts = text.split(/((`+)[^`]*?\2)/)
    let out = ''
    for (let i = 0; i < parts.length; i += 3)
        out += fn(parts[i]) + (parts[i + 1] ?? '')
    return out
}

const quote = (s: string) => `"${s.trim()}"`

function queryFence(conf: Raw): string {
    return '```query\n' + stringifyYaml(conf, { lineWidth: 0 }) + '```'
}

// ---- main ------------------------------------------------------------------------------

export function convertBases(
    files: VaultText,
    ctx: ImportContext,
    tags: string[],
): StepResult {
    const taken = new Set(ctx.allPaths)
    const items: ReportItem[] = []
    const edits = new Map<string, string | null>()
    const exists = (p: string) => edits.has(p) || files.has(p) || taken.has(p)
    const text = (p: string) => (edits.has(p) ? edits.get(p) : files.get(p))
    const basePaths = [...files.keys()].filter(p => p.endsWith('.base')).sort()
    const parsed = new Map<string, ParsedBase>()
    // where each parsed base's views landed: view name → vault path (no extension for md, jsonl stem)
    const landed = new Map<string, { names: string[]; targets: string[] }>()

    for (const path of basePaths) {
        const b = parseBase(path, files.get(path)!, items)
        if (!b) continue
        parsed.set(path, b)
        const d = dir(path)
        const name = baseOf(stem(path))
        const mdPath = joinPath(d, name + '.md')
        const mdText = files.get(mdPath)
        const embedRe = new RegExp(
            `!\\[\\[(?:[^\\]|#]*/)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.base(?:[|#][^\\]]*)?\\]\\]`,
        )
        const embedAll = new RegExp(embedRe.source, 'g')
        const isMerge = mdText !== undefined && embedRe.test(mdText)
        const collides = mdText !== undefined && !isMerge
        const v1 = b.views[0]
        const plainFirst = joinPath(d, `${name}.base.jsonl`)
        const renamed = collides || (!isMerge && exists(plainFirst))
        let first = isMerge ? mdPath : plainFirst
        if (renamed) {
            first = joinPath(d, `${name} - ${safeName(v1.name)}.base.jsonl`)
            for (let n = 2; exists(first); n++)
                first = joinPath(d, `${name} - ${safeName(v1.name)} ${n}.base.jsonl`)
        }
        const firstRef = first.replace(/\.base\.jsonl$/, '').replace(/\.md$/, '')
        const written: string[] = []
        const targets = [first]

        const c1 = flatConfig(b, v1, { source: 'notes' }, tags, items, path)
        if (isMerge) {
            const body = mdText!
                .split('\n')
                .flatMap(l => {
                    if (!embedRe.test(l)) return [l]
                    const s = l.replace(embedAll, '')
                    return s.trim() ? [s] : []
                })
                .join('\n')
            // mutateFrontmatter hands its callback a plain object on a note with no frontmatter
            const merged = FRONTMATTER_REGEX.test(body)
                ? mutateFrontmatter(body, (doc, data) => {
                      const next = { ...c1 }
                      for (const [k, val] of Object.entries(next)) doc.set(k, val)
                      return { keep: Object.keys(data).length + Object.keys(next).length > 0, result: '' }
                  })
                : `---\n${stringifyYaml(c1, { lineWidth: 0 })}---\n${body}`
            edits.set(mdPath, merged)
            items.push({
                section: 'converted',
                area: 'bases',
                path,
                detail: `${path} merged into ${mdPath} (type: base note keeping its prose; Bismuth shows the base only, the prose stays in the file)`,
            })
        } else {
            edits.set(first, serializeBaseJsonl(c1, []))
            items.push({
                section: 'converted',
                area: 'bases',
                path,
                detail: `${path} -> ${first}`,
            })
            if (renamed)
                items.push({
                    section: 'defaults',
                    area: 'bases',
                    path,
                    detail: collides
                        ? `${mdPath} exists and does not embed ${path}; the base is written as ${first}`
                        : `${plainFirst} already exists; the base is written as ${first}`,
                })
        }
        written.push(first)
        for (let i = 1; i < b.views.length; i++) {
            const v = b.views[i]
            let p = joinPath(d, `${name} - ${safeName(v.name)}.base.jsonl`)
            for (let n = 2; exists(p); n++)
                p = joinPath(d, `${name} - ${safeName(v.name)} ${n}.base.jsonl`)
            const cv = flatConfig(b, v, { ref: `[[${firstRef}]]` }, tags, items, path)
            // a split view reads only the referenced base's rows, so the filters are restated
            // (flatConfig already merged global + view); formulas and properties stay so formula.x resolves
            edits.set(p, serializeBaseJsonl(cv, []))
            written.push(p)
            targets.push(p)
        }
        edits.set(path, null)
        landed.set(path, { names: b.views.map(v => v.name), targets })
        if (b.views.length > 1)
            items.push({
                section: 'decide',
                area: 'bases',
                path,
                detail: `${b.views.length} views split into ${written.join(', ')}; view names dropped: ${b.views.map(v => `"${v.name}"`).join(', ')}; keep the split or merge them by hand`,
            })
    }

    // resolve `X.base` / `P/X.base` / `X.base#View` to a parsed base
    const resolve = (target: string): ParsedBase | null => {
        const t = target.replace(/^\/+/, '')
        if (parsed.has(t)) return parsed.get(t)!
        const hits = [...parsed.keys()]
            .filter(p => p === t || p.endsWith('/' + t) || baseOf(p) === baseOf(t))
            .sort((a, z) => a.split('/').length - z.split('/').length)
        return hits.length ? parsed.get(hits[0])! : null
    }
    const embedConf = (b: ParsedBase, view: string | undefined, where: string): Raw | null => {
        let v = b.views[0]
        if (view !== undefined) {
            const hit = b.views.find(x => x.name === view)
            if (!hit) return null
            v = hit
        }
        return flatConfig(b, v, { source: 'notes' }, tags, [], where)
    }

    for (const [path] of files) {
        if (!path.endsWith('.md')) continue
        const start = text(path) as string
        const out = splitFences(start)
            .map(seg => {
                if (seg.fence) {
                    if (!/^base(\s|$)/.test(seg.info)) return seg.text
                    const ls = seg.text.replace(/\n$/, '').split('\n')
                    if (ls.length < 3 || !/^ {0,3}(`{3,}|~{3,})\s*$/.test(ls[ls.length - 1])) return seg.text
                    const yaml = ls.slice(1, -1).join('\n')
                    const b = ((): ParsedBase | null => {
                        try {
                            return fromDoc(path, parseYaml(yaml) ?? {}, items)
                        } catch {
                            items.push({ section: 'decide', area: 'bases', path, detail: 'a base fence does not parse as YAML, left as written' })
                            return null
                        }
                    })()
                    if (!b) return seg.text
                    const conf = flatConfig(b, b.views[0], { source: 'notes' }, tags, items, path)
                    if (b.views.length > 1)
                        items.push({ section: 'decide', area: 'bases', path, detail: `a base fence with ${b.views.length} views keeps only view 1; dropped views: ${b.views.slice(1).map(v => `"${v.name}"`).join(', ')}` })
                    items.push({ section: 'converted', area: 'bases', path, detail: 'base fence -> query fence' })
                    return queryFence(conf) + (seg.text.endsWith('\n') ? '\n' : '')
                }
                return outsideCode(seg.text, s => {
                    s = s.replace(
                        /!\[\[([^\]|#]+\.base)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]/g,
                        (whole, target: string, view: string | undefined, off: number) => {
                            const b = resolve(target)
                            const conf = b ? embedConf(b, view, path) : null
                            if (!b || !conf) {
                                items.push({ section: 'decide', area: 'bases', path, detail: `${whole} names ${b ? 'a view that does not exist' : 'a base that is not in the vault'}, left as written` })
                                return whole
                            }
                            const lineStart = s.lastIndexOf('\n', off - 1) + 1
                            const lead = s.slice(lineStart, off)
                            if (/^\s*(?:[-*+]|\d+[.)])\s/.test(lead)) {
                                items.push({ section: 'decide', area: 'bases', path, detail: `${whole} sits inside a list item, left as written: ${quote(s.slice(lineStart, s.indexOf('\n', off) === -1 ? undefined : s.indexOf('\n', off)))}` })
                                return whole
                            }
                            items.push({ section: 'converted', area: 'bases', path, detail: `${whole} -> query fence` })
                            // inside a callout or blockquote every fence line keeps the line's > prefix
                            const prefix = /^\s*(?:>\s*)+/.exec(lead)?.[0] ?? ''
                            const before = off > 0 && s[off - 1] !== '\n' && !(prefix && lead === prefix) ? '\n' : ''
                            const after = s[off + whole.length] !== undefined && s[off + whole.length] !== '\n' ? '\n' : ''
                            const fence = queryFence(conf)
                                .split('\n')
                                .map((l, i) => (i === 0 && !before ? l : prefix + l))
                                .join('\n')
                            return before + fence + (after ? after + prefix : '')
                        },
                    )
                    return s.replace(
                        /(?<!!)\[\[([^\]|#]+)\.base(#[^\]|]*)?((?:\|[^\]]*)?)\]\]/g,
                        (_w, t: string, view: string | undefined, rest: string) => {
                            const b = resolve(t + '.base')
                            const name = view?.slice(1)
                            const info = b ? landed.get(b.path) : undefined
                            const at = info && name ? info.names.indexOf(name) : -1
                            if (info && at <= 0) {
                                const f = info.targets[0].replace(/\.base\.jsonl$/, '').replace(/\.md$/, '')
                                if (baseOf(f) !== baseOf(t)) return `[[${f}${rest}]]`
                            }
                            if (info && at > 0) {
                                const tgt = info.targets[at].replace(/\.base\.jsonl$/, '')
                                return `[[${tgt}${rest}]]`
                            }
                            return `[[${t}${view ?? ''}${rest}]]`
                        },
                    )
                })
            })
            .join('')
        if (out !== start) edits.set(path, out)
    }

    const list: FileEdit[] = [...edits].map(([path, t]) => ({ path, text: t }))
    const seen = new Set<string>()
    const unique = items.filter(i => {
        if (i.section !== 'lossy') return true
        const k = `${i.path}\0${i.detail}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
    })
    return { edits: list, items: unique }
}
