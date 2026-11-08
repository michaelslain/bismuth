// core/src/transcript.ts
// A page file's transcript lives in its companion note (`<file>.<ext>.md`) as one marked block, so a
// re-run replaces the block and leaves everything else in the note alone: tags, comments, the
// reader's own text. The frontmatter records which engine produced it and when.
//
// The pure functions (render / merge / read) import no node module; the one write goes through
// fileAccess so this file loads on the iPad's in-process core too.
import { mutateFrontmatter, setFrontmatterKey, FRONTMATTER_REGEX } from './frontmatter'
import { getFileAccess } from './fileAccess'
import { addMarks, markQuotesIn, markQuotesOnPage } from './bookMarks'
import { checkKey, liveChecks } from './transcriptChecks'

export { checkKey, liveChecks }

/** Frontmatter `transcribed:` values: the transcriber that produced the text. */
export type TranscriptEngine = 'on-device' | 'marker' | 'ai'
/** What a request may ask for; `auto` runs on-device first, then re-reads math pages with marker and other hard pages with ai. */
export type TranscribeEngine = 'auto' | TranscriptEngine
/** How much a stored line needs a person's eye: `unsure` (yellow) may hold a wrong word, `garbled`
 *  (red) is mostly wrong or was not read at all. */
export type CheckLevel = 'unsure' | 'garbled'
/** One line of a page's text flagged for review, keyed by the line's text (marks and spacing
 *  ignored). An empty `line` flags the whole page: the reader returned nothing for a page with writing. */
export type TranscriptCheck = { line: string; level: CheckLevel }
export type PageText = { page: number; text: string; checks?: TranscriptCheck[] }
/** What kind of file the pages came from: one image is one page, a pdf has many. */
type PageFileKind = 'image' | 'pdf'

export const TRANSCRIPT_START = '<!-- bismuth:transcript:start -->'
export const TRANSCRIPT_END = '<!-- bismuth:transcript:end -->'

/** The body without the transcript block's marker comments, for indexing and excerpts. */
export const stripTranscriptMarkers = (s: string): string =>
    s.replace(CHECKS_LINE, '').replaceAll(TRANSCRIPT_START, '').replaceAll(TRANSCRIPT_END, '')

const HEADING = /^### Page (\d+)[ \t]*$/m
/** The block's first line when any page has checks: `{"<page>":[["<line>","unsure"|"garbled"]]}`. */
const CHECKS_PREFIX = '<!-- bismuth:transcript:checks '
const CHECKS_LINE = /^<!-- bismuth:transcript:checks (.*?) -->[ \t]*\n?/m


/** The block's text with its checks line taken out, and the checks it held by page. */
function splitChecks(inner: string): { inner: string; byPage: Map<number, TranscriptCheck[]> } {
    const byPage = new Map<number, TranscriptCheck[]>()
    const m = inner.match(CHECKS_LINE)
    if (!m) return { inner, byPage }
    try {
        const data = JSON.parse(m[1]) as Record<string, unknown>
        for (const [k, v] of Object.entries(data)) {
            const page = Number(k)
            if (!Number.isInteger(page) || !Array.isArray(v)) continue
            const list = v
                .filter((e): e is [string, CheckLevel] => Array.isArray(e) && typeof e[0] === 'string' && (e[1] === 'unsure' || e[1] === 'garbled'))
                .map(([line, level]) => ({ line, level }))
            if (list.length) byPage.set(page, list)
        }
    } catch {
        // an unreadable checks line holds nothing
    }
    return { inner: inner.replace(CHECKS_LINE, ''), byPage }
}

function checksLine(pages: PageText[]): string {
    const data: Record<string, [string, CheckLevel][]> = {}
    for (const p of pages) {
        const live = liveChecks(p.text, p.checks)
        if (live.length) data[p.page] = live.map(c => [c.line, c.level])
    }
    if (Object.keys(data).length === 0) return ''
    // `-->` inside a quoted line would end the comment early.
    return `${CHECKS_PREFIX}${JSON.stringify(data).replaceAll('-->', '--\\u003e')} -->\n`
}

/** The block's inner markdown: `### Page N` headings in page order. A lone image page has no heading. */
export function renderTranscript(pages: PageText[], kind: PageFileKind): string {
    const sorted = [...pages].sort((a, b) => a.page - b.page)
    // The end marker inside page text would cut the block short on the next read.
    const clean = (t: string) => t.replaceAll(TRANSCRIPT_END, '').trim()
    if (kind === 'image' && sorted.length === 1) return clean(sorted[0].text)
    return sorted.map(p => `### Page ${p.page}\n\n${clean(p.text)}`).join('\n\n')
}

function blockOf(pages: PageText[], kind: PageFileKind): string {
    return `${TRANSCRIPT_START}\n${checksLine(pages)}${renderTranscript(pages, kind)}\n${TRANSCRIPT_END}`
}

/** The note body with its transcript block replaced by `block`, or the block appended when the body has none. */
function spliceBlock(body: string, block: string): string {
    const start = body.indexOf(TRANSCRIPT_START)
    const end = start < 0 ? -1 : body.indexOf(TRANSCRIPT_END, start)
    if (start >= 0 && end >= 0) return body.slice(0, start) + block + body.slice(end + TRANSCRIPT_END.length)
    if (body === '') return `${block}\n`
    return `${body}${body.endsWith('\n') ? '' : '\n'}\n${block}\n`
}

/** The body with the transcript block (markers included) cut out, and one blank line of the gap with it. */
function dropBlock(body: string): string {
    const start = body.indexOf(TRANSCRIPT_START)
    const end = start < 0 ? -1 : body.indexOf(TRANSCRIPT_END, start)
    if (start < 0 || end < 0) return body
    let before = body.slice(0, start)
    let after = body.slice(end + TRANSCRIPT_END.length).replace(/^\n/, '')
    if (after === '' && before.endsWith('\n\n')) before = before.slice(0, -1)
    return before + after
}

/** The companion with its transcript block set to exactly `pages`: no engine restamp, no mark
 *  carry-over, so the text given is the text kept. No pages removes the block. */
function withPages(companion: string, pages: PageText[], kind: PageFileKind): string {
    const fm = companion.match(FRONTMATTER_REGEX)
    const head = fm ? fm[0] : ''
    const body = companion.slice(head.length)
    if (pages.length === 0) return head + dropBlock(body)
    return head + spliceBlock(body, blockOf(pages, kind))
}

/** Put the block into a companion's markdown and stamp `transcribed` + `transcribedAt`. */
export function mergeTranscript(
    companion: string,
    pages: PageText[],
    engine: TranscriptEngine,
    kind: PageFileKind,
    now: Date = new Date(),
): string {
    const fm = companion.match(FRONTMATTER_REGEX)
    const head = fm ? fm[0] : ''
    const body = companion.slice(head.length)
    const block = blockOf(pages, kind)
    // Marks the reader made on a page survive a re-run when their text is still there. Marks the
    // incoming text already carries (a page filled from the stored transcript) are not applied twice.
    const kept = pages.map(p => {
        const marks = markQuotesOnPage(companion, p.page)
        for (const have of markQuotesIn(p.text)) {
            const i = marks.indexOf(have)
            if (i >= 0) marks.splice(i, 1)
        }
        return { page: p.page, marks }
    })
    let md = head + spliceBlock(body, block)
    for (const k of kept) if (k.marks.length) md = addMarks(md, k.page, k.marks)
    md = setFrontmatterKey(md, 'transcribed', engine)
    md = setFrontmatterKey(md, 'transcribedAt', now.toISOString())
    return md
}

/** The pages stored in a companion's transcript block; [] when it has none. */
export function readTranscript(companion: string): PageText[] {
    const start = companion.indexOf(TRANSCRIPT_START)
    if (start < 0) return []
    const from = start + TRANSCRIPT_START.length
    const end = companion.indexOf(TRANSCRIPT_END, from)
    if (end < 0) return []
    const split = splitChecks(companion.slice(from, end).replace(/^\n/, ''))
    const inner = split.inner.trim()
    const withChecks = (page: number, text: string): PageText => {
        const checks = liveChecks(text, split.byPage.get(page))
        return checks.length ? { page, text, checks } : { page, text }
    }
    // A block with no text can still flag a page the reader returned nothing for.
    if (!inner)
        return [...split.byPage.keys()].sort((a, b) => a - b).flatMap(page => {
            const p = withChecks(page, '')
            return p.checks ? [p] : []
        })
    const parts = inner.split(/^(?=### Page \d+[ \t]*$)/m)
    if (!HEADING.test(inner)) return [withChecks(1, inner)]
    const out: PageText[] = []
    for (const part of parts) {
        const m = part.match(HEADING)
        if (!m) continue
        out.push(withChecks(Number(m[1]), part.slice(m[0].length).trim()))
    }
    return out
}

/** Add `[[book]]` to the note's `books` list unless it is already there. */
const bookName = (b: string): string =>
    b.replace(/^\[\[|\]\]$/g, '').split('/').pop()!.replace(/\.base\.jsonl$|\.md$/, '')

function addBook(md: string, book: string): string {
    const name = bookName(book)
    const link = `[[${name}]]`
    return mutateFrontmatter(md, (doc, data) => {
        const have = data.books
        const list = Array.isArray(have) ? (have as unknown[]) : have ? [have] : []
        if (list.some(e => typeof e === 'string' && bookName(e) === name)) return { keep: true, result: '' }
        const next = [...list, link]
        if (doc.set) {
            const node = doc.createNode(next)
            node.flow = true
            doc.set('books', node)
        } else data.books = next
        return { keep: true, result: '' }
    })
}

/** Read the companion (empty when missing), merge the transcript, optionally file it under a book,
 *  write it back. `rel` is the vault-relative companion path. */
export async function writeTranscript(
    root: string,
    rel: string,
    pages: PageText[],
    engine: TranscriptEngine,
    kind: PageFileKind,
    opts: { book?: string; now?: Date; mark?: (paths: string[]) => void } = {},
): Promise<string> {
    const files = await getFileAccess()
    const current = await files.readNote(root, rel).catch(e => {
        if ((e as { code?: string })?.code === 'ENOENT') return ''
        throw e
    })
    let md = mergeTranscript(current, pages, engine, kind, opts.now)
    if (opts.book) md = addBook(md, opts.book)
    opts.mark?.([rel])
    await files.writeNote(root, rel, md)
    return md
}

/** One page's text set by hand: replaces (or adds) that page in the block and keeps the other pages
 *  and the frontmatter as they are. The text is kept exactly as written, `==marks==` included; text
 *  empty after trim removes the page. */
export function setTranscriptPage(companion: string, page: number, text: string, kind: PageFileKind): string {
    const all = readTranscript(companion)
    const old = all.find(p => p.page === page)
    const pages = all.filter(p => p.page !== page)
    const clean = text.replaceAll(TRANSCRIPT_END, '').trim()
    if (clean !== '') {
        const checks = liveChecks(clean, old?.checks)
        pages.push(checks.length ? { page, text: clean, checks } : { page, text: clean })
    }
    return withPages(companion, pages, kind)
}

/** Write `setTranscriptPage` back: read the companion (a missing one reads as empty), mark, write.
 *  A text that leaves the note unchanged writes nothing. `rel` is the vault-relative companion path. */
export async function writeTranscriptPage(
    root: string,
    rel: string,
    page: number,
    text: string,
    kind: PageFileKind,
    opts: { mark?: (paths: string[]) => void } = {},
): Promise<void> {
    const files = await getFileAccess()
    const current = await files.readNote(root, rel).catch(e => {
        if ((e as { code?: string })?.code === 'ENOENT') return ''
        throw e
    })
    const next = setTranscriptPage(current, page, text, kind)
    if (next === current) return
    opts.mark?.([rel])
    await files.writeNote(root, rel, next)
}

/** The companion's transcript after the pdf's pages were rewritten. `sources[i]` is the 0-based old
 *  page now at new page i + 1, or null for a page with no text yet. A page used twice keeps its text
 *  on both; an old page no longer used drops. Frontmatter and the rest of the note stay. */
export function remapTranscriptPages(companion: string, sources: (number | null)[]): string {
    const old = readTranscript(companion)
    if (old.length === 0) return companion
    const byPage = new Map(old.map(p => [p.page, p]))
    const pages: PageText[] = []
    sources.forEach((src, i) => {
        const was = src === null ? undefined : byPage.get(src + 1)
        if (was !== undefined) pages.push({ ...was, page: i + 1 })
    })
    return withPages(companion, pages, 'pdf')
}

/** The companion with one check cleared: the line on `page` whose text matches `line` (an empty
 *  `line` clears the whole-page check). The text itself is not touched. */
export function approveCheck(companion: string, page: number, line: string, kind: PageFileKind): string {
    const pages = readTranscript(companion)
    const target = pages.find(p => p.page === page)
    if (!target?.checks?.length) return companion
    const key = checkKey(line)
    const at = target.checks.findIndex(c => checkKey(c.line) === key)
    if (at < 0) return companion
    const checks = target.checks.filter((_, i) => i !== at)
    const next = pages.map(p => (p.page === page ? { ...p, checks } : p))
    return withPages(companion, next, kind)
}

/** Write `approveCheck` back; nothing is written when no check matched. Returns the page's checks left. */
export async function writeApprovedCheck(
    root: string,
    rel: string,
    page: number,
    line: string,
    kind: PageFileKind,
    opts: { mark?: (paths: string[]) => void } = {},
): Promise<TranscriptCheck[]> {
    const files = await getFileAccess()
    const current = await files.readNote(root, rel).catch(e => {
        if ((e as { code?: string })?.code === 'ENOENT') return ''
        throw e
    })
    const next = approveCheck(current, page, line, kind)
    if (next !== current) {
        opts.mark?.([rel])
        await files.writeNote(root, rel, next)
    }
    return readTranscript(next).find(p => p.page === page)?.checks ?? []
}
