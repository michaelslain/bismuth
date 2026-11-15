import { parseFrontmatter } from '../frontmatter'
import { stripCode } from '../wikilinks'
import { parseList } from '../schema/coerce'
import type { ImportContext, ReportItem, StepResult, VaultText } from './types'

// Link rewrites for the Obsidian importer. Every match is found on `stripCode(text)` (same
// length as the text, code blanked), and applied to the original at the same offsets, so a
// fence or code span stays byte-identical.

const WIKILINK = /(?<!!)\[\[([^\]]+?)\]\]/g
const EMBED_MD = /!\[\[([^\]|#]+?)\.md((?:[#|][^\]]*)?)\]\]/gi
const MD_LINK = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

type Note = { path: string; base: string; key: string }

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/** Resolve `rel` against the folder `from` (posix, `.`/`..` folded away). */
function resolveRel(from: string, rel: string): string {
    const out = from ? from.split('/') : []
    for (const part of rel.split('/')) {
        if (part === '.' || part === '') continue
        if (part === '..') out.pop()
        else out.push(part)
    }
    return out.join('/')
}
const noExt = (p: string) => p.replace(/\.md$/i, '')
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

function lineOf(text: string, at: number): string {
    const s = text.lastIndexOf('\n', at - 1) + 1
    const e = text.indexOf('\n', at)
    return text.slice(s, e === -1 ? undefined : e)
}

const inTable = (text: string, at: number) => lineOf(text, at).trimStart().startsWith('|')

function notesOf(allPaths: string[]): Note[] {
    return allPaths
        .filter(p => /\.md$/i.test(p) && !baseOf(p).startsWith('.'))
        .map(p => ({ path: p, key: noExt(p), base: baseOf(noExt(p)) }))
}

/** Notes a `[[t]]` target names exactly: by path (whole or trailing) or by basename. */
function exactNotes(notes: Note[], t: string): Note[] {
    return notes.filter(n => n.key === t || n.key.endsWith('/' + t) || (!t.includes('/') && n.base === t))
}

function nameFor(note: Note, notes: Note[]): string {
    return notes.filter(n => n.base === note.base).length > 1 ? note.key : note.base
}

/** Obsidian's link formats: relative to the note, a path from the vault root ("absolute path in
 *  vault"), or the shortest name. `./` and `../` are only ever note-relative. First candidate that
 *  names a note wins; none → the note-relative form (reported as unresolved by validation). */
// The wikilink target a markdown link to a note resolves to, or null when it names no note in the
// vault: a link that was already broken in Obsidian stays a markdown link, as written, rather than
// being rewritten to a guessed path that resolves nowhere either.
function resolveMdTarget(file: string, notePath: string, notes: Note[]): string | null {
    const has = (c: string) => notes.some(n => n.key === noExt(c))
    const rel = resolveRel(dirOf(notePath), file)
    if (file.startsWith('./') || file.startsWith('../')) return has(rel) ? noExt(rel) : null
    const root = file.replace(/^\/+/, '')
    if (file.startsWith('/')) return has(root) ? noExt(root) : null
    if (has(rel)) return noExt(rel)
    if (has(root)) return noExt(root)
    const byName = exactNotes(notes, noExt(root))
    if (byName.length === 1) return byName[0].key
    return null
}

export function rewriteLinks(files: VaultText, ctx: ImportContext): StepResult {
    const notes = notesOf(ctx.allPaths)
    const aliases = new Map<string, Note[]>()
    for (const [path, text] of files) {
        if (!/\.md$/i.test(path)) continue
        const note = notes.find(n => n.path === path)
        if (!note) continue
        for (const a of parseList(parseFrontmatter(text).data.aliases)) {
            const alias = String(a).trim()
            if (!alias) continue
            aliases.set(alias, [...(aliases.get(alias) ?? []), note])
        }
    }

    const edits: StepResult['edits'] = []
    const items: ReportItem[] = []

    for (const [path, text] of files) {
        if (!/\.md$/i.test(path)) continue
        if (text.indexOf('[') === -1) continue
        const masked = stripCode(text)
        const reps: Array<{ at: number; len: number; to: string }> = []
        const decide = (detail: string) => items.push({ section: 'decide', area: 'links', path, detail })
        let converted = 0

        for (const m of masked.matchAll(WIKILINK)) {
            const raw = m[1]
            const bar = raw.indexOf('|')
            const left = bar === -1 ? raw : raw.slice(0, bar)
            const display = bar === -1 ? null : raw.slice(bar + 1)
            const hash = left.indexOf('#')
            const target = (hash === -1 ? left : left.slice(0, hash)).trim()
            const anchor = hash === -1 ? '' : left.slice(hash)
            if (!target || /\.base$/i.test(target)) continue
            const at = m.index!
            const quote = m[0]
            const emit = (t: string, d: string | null) => {
                reps.push({ at, len: quote.length, to: `[[${t}${anchor}${d === null ? '' : '|' + d}]]` })
                converted++
            }

            if (target.endsWith('\\')) {
                decide(`wikilink inside a table row ends in a backslash (an escaped pipe), left as ${quote}`)
                continue
            }
            if (/\.md$/i.test(target)) {
                emit(noExt(target), display)
                continue
            }
            if (ctx.allPaths.includes(target)) continue
            const exact = exactNotes(notes, target)
            const owners = aliases.get(target)
            if (owners) {
                // Obsidian resolves a file name before an alias, so a link whose target is also a
                // note's own name already opens that note in both apps: nothing to rewrite or report.
                if (exact.length) {
                    continue
                } else if (owners.length > 1) {
                    decide(`alias "${target}" belongs to ${owners.length} notes, left as ${quote}`)
                } else if (inTable(text, at)) {
                    decide(`alias link in a table row needs a pipe, left as ${quote}`)
                } else {
                    emit(nameFor(owners[0], notes), display ?? (anchor ? null : target))
                }
                continue
            }
            if (exact.length) continue
            const lc = target.toLowerCase()
            const loose = notes.filter(
                n => n.key.toLowerCase() === lc || n.key.toLowerCase().endsWith('/' + lc) || (!lc.includes('/') && n.base.toLowerCase() === lc),
            )
            if (loose.length === 1) emit(target.includes('/') ? loose[0].key : loose[0].base, display)
            else if (loose.length > 1) decide(`${quote} matches ${loose.length} notes by case, left as written`)
        }

        for (const m of masked.matchAll(EMBED_MD)) {
            reps.push({ at: m.index!, len: m[0].length, to: `![[${m[1]}${m[2]}]]` })
            converted++
        }

        for (const m of masked.matchAll(MD_LINK)) {
            let url = m[2]
            if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('<')) continue
            const h = url.indexOf('#')
            let file = h === -1 ? url : url.slice(0, h)
            let anchor = h === -1 ? '' : url.slice(h)
            if (!/\.md$/i.test(file)) {
                try { file = decodeURIComponent(file) } catch {}
                if (!/\.md$/i.test(file)) continue
            }
            try {
                file = decodeURIComponent(file)
                anchor = decodeURIComponent(anchor)
            } catch {}
            const target = resolveMdTarget(file, path, notes)
            if (target === null) continue
            const text0 = m[1].replace(/\|/g, '-')
            const at = m.index!
            if (text0 && inTable(text, at)) {
                decide(`markdown link in a table row needs a pipe, left as ${m[0]}`)
                continue
            }
            reps.push({ at, len: m[0].length, to: `[[${target}${anchor}${text0 ? '|' + text0 : ''}]]` })
            converted++
        }

        if (!reps.length) continue
        reps.sort((a, b) => b.at - a.at)
        let out = text
        for (const r of reps) out = out.slice(0, r.at) + r.to + out.slice(r.at + r.len)
        if (out !== text) edits.push({ path, text: out })
        if (converted) items.push({ section: 'converted', area: 'links', path, detail: `${converted} link(s) rewritten to Bismuth wikilinks` })
    }
    return { edits, items }
}

export function unresolvedLinks(files: VaultText, allPaths: string[]): Array<{ path: string; target: string }> {
    const notes = notesOf(allPaths)
    const out: Array<{ path: string; target: string }> = []
    for (const [path, text] of files) {
        if (!/\.md$/i.test(path) || text.indexOf('[[') === -1) continue
        const seen = new Set<string>()
        for (const m of stripCode(text).matchAll(/\[\[([^\]]+?)\]\]/g)) {
            const target = m[1].split('|')[0].split('#')[0].trim()
            if (!target || seen.has(target)) continue
            seen.add(target)
            const ok =
                !/\.md$/i.test(target) &&
                !target.split('/').includes('..') &&
                (exactNotes(notes, target).length > 0 ||
                    allPaths.some(p => !/\.md$/i.test(p) && (p === target || p.endsWith('/' + target))) ||
                    allPaths.some(p => p === target + '.base.jsonl' || p.endsWith('/' + target + '.base.jsonl')))
            if (!ok) out.push({ path, target })
        }
    }
    return out
}
