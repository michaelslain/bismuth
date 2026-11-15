import { FRONTMATTER_REGEX, mutateFrontmatter, parseFrontmatter } from '../frontmatter'
import { INLINE_TAG_REGEX, extractTags } from '../tags'
import { normalizeTag, parseList } from '../schema/coerce'
import { stripCode } from '../wikilinks'
import type { ReportItem, StepResult, VaultText } from './types'

/** What Obsidian extracts as a tag: `#` after whitespace, then a run of characters other than
 *  whitespace and ``#[]{}()<>"'`,.;:!?*|\\^``; it needs at least one non-digit. */
const OBSIDIAN_TAG = /(?:^|\s)#([^\s#[\]{}()<>"'`,.;:!?*|\\^]+)/gu

/** The `tags` field as a list: a string splits on commas and whitespace (Obsidian's `tags: a b`). */
function fmTags(value: unknown): string[] {
    if (typeof value === 'string') return value.split(/[\s,]+/).map(normalizeTag).filter(Boolean)
    return parseList(value).map(t => normalizeTag(String(t))).filter(Boolean)
}

function inlineTags(body: string): Array<{ name: string; at: number }> {
    const out: Array<{ name: string; at: number }> = []
    for (const m of stripCode(body).matchAll(INLINE_TAG_REGEX)) {
        out.push({ name: m[1], at: m.index! + m[0].length - m[1].length })
    }
    return out
}

export function collectVaultTags(files: VaultText): string[] {
    const all = new Set<string>()
    for (const [path, text] of files) {
        if (!/\.md$/i.test(path)) continue
        const { data, body } = parseFrontmatter(text)
        for (const t of extractTags(data, body)) all.add(t)
    }
    return [...all].sort()
}

export function normalizeTags(files: VaultText): StepResult {
    const counts = new Map<string, number>()
    const bump = (t: string) => counts.set(t, (counts.get(t) ?? 0) + 1)
    for (const [path, text] of files) {
        if (!/\.md$/i.test(path)) continue
        const { data, body } = parseFrontmatter(text)
        for (const t of fmTags(data.tags)) bump(t)
        for (const t of inlineTags(body)) bump(t.name)
    }

    const groups = new Map<string, string[]>()
    for (const t of counts.keys()) groups.set(t.toLowerCase(), [...(groups.get(t.toLowerCase()) ?? []), t])
    const winner = new Map<string, string>()
    const items: ReportItem[] = []
    for (const spellings of groups.values()) {
        if (spellings.length < 2) continue
        spellings.sort((a, b) => a.localeCompare(b))
        const best = Math.max(...spellings.map(s => counts.get(s)!))
        const top = spellings.filter(s => counts.get(s) === best)
        const w = top.length === 1 ? top[0] : (top.find(s => s === s.toLowerCase()) ?? top[0])
        for (const s of spellings) winner.set(s, w)
        items.push({
            section: 'defaults',
            area: 'tags',
            path: '',
            detail: `tags ${spellings.map(s => '#' + s).join(', ')} differ only by case, all written as #${w}`,
        })
    }
    const fix = (t: string) => winner.get(t) ?? t

    const edits: StepResult['edits'] = []
    for (const [path, text] of files) {
        if (!/\.md$/i.test(path)) continue
        let out = text
        const fm = parseFrontmatter(out)
        if (FRONTMATTER_REGEX.test(out) && fm.data.tags != null) {
            const tags = fmTags(fm.data.tags)
            const next = tags.map(fix)
            // A comma string is already read as a list by Bismuth: leave it as written.
            const raw = typeof fm.data.tags === 'string' ? fm.data.tags.trim() : null
            const commaString = raw !== null && raw.includes(',')
            const needs = !commaString && ((raw !== null && /\s/.test(raw)) || next.some((t, i) => t !== tags[i]))
            if (needs) {
                out = mutateFrontmatter(out, (doc, data) => {
                    if (typeof doc.createNode === 'function') {
                        const seq = doc.createNode(next)
                        seq.flow = true
                        doc.set('tags', seq)
                    } else data.tags = next
                    return { keep: true, result: '' }
                })
                items.push({ section: 'converted', area: 'tags', path, detail: `frontmatter tags written as [${next.join(', ')}]` })
            }
        }

        const m = out.match(FRONTMATTER_REGEX)
        const head = m ? m[0] : ''
        const body = out.slice(head.length)
        let nb = body
        for (const t of inlineTags(body).reverse()) {
            const to = fix(t.name)
            if (to !== t.name) nb = nb.slice(0, t.at) + to + nb.slice(t.at + t.name.length)
        }
        const code = stripCode(body)
        const bismuth = new Map<number, string>()
        for (const t of inlineTags(body)) bismuth.set(t.at - 1, t.name)
        for (const c of code.matchAll(OBSIDIAN_TAG)) {
            const run = c[1]
            if (!/\D/.test(run)) continue
            const hashAt = c.index! + c[0].length - run.length - 1
            if (bismuth.get(hashAt) !== run) {
                items.push({ section: 'lossy', area: 'tags', path, detail: `inline tag #${run} is not a Bismuth tag, left as written` })
            }
        }
        if (nb !== body) {
            out = head + nb
            items.push({ section: 'converted', area: 'tags', path, detail: 'inline tags rewritten to the vault spelling' })
        }
        if (out !== text) edits.push({ path, text: out })
    }
    return { edits, items }
}
