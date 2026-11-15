// Spaced Repetition plugin conversion: SR comments onto single-line card lines, custom deck
// tags to `flashcards`, folder decks to tags. Pure; reuses core's own card parser to decide
// what a single-line card is (docs/guides/converting-obsidian-to-bismuth/flashcards.md).
import { parseCards } from '../srs/parser'
import { SR_COMMENT_RE } from '../srs/scheduler'
import { FRONTMATTER_REGEX, parseFrontmatterData, setFrontmatterKey } from '../frontmatter'
import { stripCode } from '../wikilinks'
import { fenceInfoPerLine } from './textFences'
import type { FileEdit, ImportContext, ReportItem, StepResult, VaultText } from './types'

const PLUGIN = 'obsidian-spaced-repetition'
const BASE = 'flashcards'
const SINGLE = new Set(['single-basic', 'single-reversed', 'cloze'])

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isDeckTag = (t: string) => t === BASE || t.startsWith(BASE + '/')

function configuredTags(ctx: ImportContext): string[] {
    const data = ctx.config.pluginData[PLUGIN] as { flashcardTags?: unknown } | undefined
    if (!data || !Array.isArray(data.flashcardTags)) return []
    return data.flashcardTags
        .filter((t): t is string => typeof t === 'string')
        .map(t => t.trim().replace(/^#/, ''))
        .filter(t => t && t !== BASE)
}

function mapTag(tag: string, custom: string[]): string {
    for (const c of custom) {
        if (tag === c) return BASE
        if (tag.startsWith(c + '/')) return BASE + tag.slice(c.length)
    }
    return tag
}

/** Join a standalone SR comment line onto the single-line card above it. */
function joinComments(body: string): { text: string; joined: number } {
    const lines = body.split('\n')
    const fence = fenceInfoPerLine(lines)
    const out: string[] = []
    let joined = 0
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const next = lines[i + 1]
        const startsParagraph = i === 0 || lines[i - 1].trim() === ''
        const endsParagraph = i + 2 >= lines.length || lines[i + 2].trim() === ''
        if (
            fence[i] === null &&
            next !== undefined &&
            line.trim() &&
            startsParagraph &&
            endsParagraph &&
            next.trim().startsWith('<!--SR:') &&
            SR_COMMENT_RE.test(next) &&
            !SR_COMMENT_RE.test(line)
        ) {
            const card = parseCards(line)[0]
            if (card && SINGLE.has(card.type)) {
                out.push(`${line.trimEnd()} ${next.trim()}`)
                joined++
                i++
                continue
            }
        }
        out.push(line)
    }
    return { text: out.join('\n'), joined }
}

function rewriteInline(body: string, custom: string[]): string {
    if (!custom.length) return body
    const lines = body.split('\n')
    const fence = fenceInfoPerLine(lines)
    return lines
        .map((line, i) => {
            if (fence[i] !== null) return line
            let l = line
            for (const c of custom) {
                const code = stripCode(l)
                l = l.replace(
                    new RegExp(`(^|[\\s\\[,"(])#${escapeRe(c)}(?=$|[\\s\\],")]|/)`, 'g'),
                    (m, pre: string, at: number) => (code[at + pre.length] === '#' ? `${pre}#${BASE}` : m),
                )
            }
            return l
        })
        .join('\n')
}

function fmTags(text: string): string[] | null {
    const m = FRONTMATTER_REGEX.exec(text)
    if (!m) return null
    const data = parseFrontmatterData(m[1])
    const raw = data?.tags
    if (raw === undefined || raw === null) return null
    const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/)
    return list.map(t => String(t).trim().replace(/^#/, '')).filter(Boolean)
}

function inlineDeckTags(body: string): string[] {
    return [...body.matchAll(/(?:^|[\s(])#(flashcards(?:\/[\w\/-]+)?)/gm)].map(m => m[1])
}

export function convertFlashcards(files: VaultText, ctx: ImportContext): StepResult {
    const edits: FileEdit[] = []
    const items: ReportItem[] = []
    const custom = configuredTags(ctx)
    const pluginData = ctx.config.pluginData[PLUGIN] as { convertFolderToDecks?: unknown } | undefined
    const folderDecks = pluginData?.convertFolderToDecks === true

    for (const [path, original] of files) {
        if (!path.endsWith('.md')) continue
        let text = original
        const done: string[] = []

        const fm = FRONTMATTER_REGEX.exec(text)
        const head = fm ? fm[0] : ''
        const joined = joinComments(text.slice(head.length))
        if (joined.joined) {
            text = head + joined.text
            done.push(`${joined.joined} SR comment(s) moved onto the card line`)
        }

        if (custom.length) {
            const before = text
            const tags = fmTags(text)
            if (tags && tags.some(t => mapTag(t, custom) !== t))
                text = setFrontmatterKey(text, 'tags', tags.map(t => mapTag(t, custom)))
            const h = FRONTMATTER_REGEX.exec(text)?.[0] ?? ''
            text = h + rewriteInline(text.slice(h.length), custom)
            if (text !== before) done.push('custom deck tag rewritten to flashcards')
        }

        const bodyNow = text.slice(FRONTMATTER_REGEX.exec(text)?.[0].length ?? 0)
        const decks = new Set([...(fmTags(text) ?? []).filter(isDeckTag), ...inlineDeckTags(bodyNow)])
        if (decks.size > 1)
            items.push({
                section: 'lossy',
                area: 'flashcards',
                path,
                detail: `several deck tags in one note, every card uses the first: ${[...decks].map(d => '#' + d).join(' ')}`,
            })

        if (folderDecks && path.includes('/') && parseCards(bodyNow).length > 0) {
            const tag = `${BASE}/${path.split('/')[0].replace(/\s+/g, '-')}`
            const tags = fmTags(text) ?? []
            if (!tags.includes(tag)) {
                text = setFrontmatterKey(text, 'tags', [...tags, tag])
                done.push(`folder deck added as tag #${tag}`)
            }
        }

        if (text !== original) {
            edits.push({ path, text })
            items.push({ section: 'converted', area: 'flashcards', path, detail: done.join('; ') })
        }
    }
    return { edits, items }
}
