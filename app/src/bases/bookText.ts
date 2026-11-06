// app/src/bases/bookText.ts
// Pure typesetter for the reader's text mode and its stories: sets transcript markdown as an ebook,
// justified lines and pages inside book margins (outer wider than the spine side), with headings,
// bold, `==marks==`, and math as measured boxes (`$…$` inline, `$$…$$` on its own centred line).
// The font size scales, and the pages reflow to it. Measuring is injected, so tests use fixed widths
// and the app measures text with a canvas and math with KaTeX.

export type TextSource = { file: string; pdfPage?: number; leaf: number }
/** A run of one style. A math run's `text` is its source with the `$` delimiters, so a selection
 *  over it quotes the transcript exactly. */
export type TextRun = { text: string; mark: boolean; math?: 'inline' | 'display'; bold?: true }
/** One typeset line. `start` is the index of its first word in its block's word list (marks stripped).
 *  `x` is the left edge and `y` the baseline, in page px; `gap` is the px between words; `h` is the
 *  line's advance, taller than the leading where math rises above or hangs below the text. */
export type TextLineBox = {
    runs: TextRun[]
    x: number
    y: number
    gap: number
    h: number
    source: TextSource
    last: boolean
    start: number
    placeholder?: true
    /** A display formula wider than the text is drawn at this fraction of its size to fit. */
    scale?: number
}
export type TextPage = { lines: TextLineBox[]; firstLeaf: number }
/** Margins are fractions of the page width (outer, inner) and height (top, bottom). */
export type TextStyle = { fontPx: number; leading: number; margins: { top: number; bottom: number; outer: number; inner: number } }
/** A typeset formula: its width, and how far it reaches above and below the baseline, in px. */
export type MathBox = { w: number; ascent: number; descent: number }
/** Widths of text (bold or not) and boxes of formulas. A bare function measures text only; math is
 *  then set as its source text. */
export type TextMeasure =
    | ((s: string) => number)
    | { text: (s: string, bold?: boolean) => number; math?: (tex: string, display: boolean) => MathBox }

/** The widest a justified line's word gap may stretch, in spaces; past it the line is set ragged. */
export const MAX_STRETCH = 4

/** The space between paragraphs, in lines. */
export const PARAGRAPH_GAP = 0.5

export const TEXT_FONT_FAMILY = "Georgia, 'Iowan Old Style', 'Times New Roman', serif"

/** The reader's font size steps, as multiples of the size a page's width picks. */
export const TEXT_SCALES = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75] as const

export const TEXT_STYLE = (page: { w: number; h: number }, scale = 1): TextStyle => {
    const fontPx = Math.max(6, Math.round((page.w / 26) * scale))
    return { fontPx, leading: fontPx * 1.5, margins: { top: 0.08, bottom: 0.1, outer: 0.12, inner: 0.08 } }
}

const MARK = '\u0001'
const MATH_OPEN = '\u0002'
const MATH_CLOSE = '\u0003'

type Piece = { text: string; mark: boolean; math?: 'inline'; bold?: true }
type Word = { pieces: Piece[]; text: string }
type Paragraph =
    | { kind: 'text'; words: Word[]; gap: 'blank' | 'none'; bold?: true }
    | { kind: 'display'; tex: string; mark: boolean; gap: 'blank' | 'none' }

/** A line the one above runs on into: that one is a wrapped line of prose (four words or more, not a
 *  heading) ending mid-sentence in a word (not math, a colon or a full stop), and this one starts in
 *  lower case. A notebook's wrapped prose rejoins; claims, formulas and headings keep their breaks. */
const continues = (above: string, line: string) =>
    above.trim().split(/\s+/).length >= 4 &&
    !/^#{1,6}\s/.test(above) &&
    /[\p{L}\p{N},;-]$/u.test(above.trimEnd()) &&
    !/\$$/.test(above.trimEnd()) &&
    /^\s*\p{Ll}/u.test(line)

/** Splits a block into paragraphs of words. `==` toggles a mark that may span words and paragraphs;
 *  `$…$` is one word however many spaces it holds; `$$…$$` is a paragraph of its own. */
function parse(text: string): Paragraph[] {
    // A real mark has a non-space, non-`=` character just inside both delimiters (as in core's
    // bookMarks); any other `==` is plain text. Real delimiters become a sentinel to split on.
    const marked = text.replace(/==(?![=\s])([^\n]*?[^\s=])==/g, `${MARK}$1${MARK}`)
    const out: Paragraph[] = []
    let mark = false
    const toggles = (s: string) => (s.split(MARK).length - 1) % 2 === 1
    for (const [bi, chunk] of marked.split(/\n\s*\n/).entries()) {
        // display math first: its own paragraphs, in place
        const parts = chunk.split(/\$\$([\s\S]+?)\$\$/)
        let first = true
        for (let pi = 0; pi < parts.length; pi++) {
            const gap = (): 'blank' | 'none' => {
                const g = first && bi > 0 ? 'blank' : 'none'
                first = false
                return g
            }
            if (pi % 2 === 1) {
                const tex = parts[pi].replaceAll(MARK, '').trim()
                if (toggles(parts[pi])) mark = !mark
                if (tex) out.push({ kind: 'display', tex, mark, gap: gap() })
                continue
            }
            // lines: join wrapped prose, keep other breaks
            const lines: string[] = []
            for (const raw of parts[pi].split('\n')) {
                if (raw.trim() === '') continue
                if (lines.length && continues(lines[lines.length - 1].replaceAll(MARK, ''), raw.replaceAll(MARK, ''))) lines[lines.length - 1] += ` ${raw.trim()}`
                else lines.push(raw.trim())
            }
            for (const line of lines) {
                const heading = /^#{1,6}\s+/.exec(line)
                const body = heading ? line.slice(heading[0].length) : line
                // inline math becomes one sentinel-wrapped token: spaces inside it do not split words
                const guarded = body.replace(/\$(?!\$)([^$\n]+?)\$/g, (_m, tex: string) => `${MATH_OPEN}${tex.replace(/\s/g, '\u0004')}${MATH_CLOSE}`)
                const words: Word[] = []
                for (const token of guarded.split(/\s+/)) {
                    const pieces: Piece[] = []
                    let bold = false
                    token.split(MARK).forEach((seg, i) => {
                        if (i > 0) mark = !mark
                        for (const [j, bit] of seg.split(/(\u0002[^\u0003]*\u0003)/).entries()) {
                            if (!bit) continue
                            if (j % 2 === 1) {
                                pieces.push({ text: `$${bit.slice(1, -1).replace(/\u0004/g, ' ')}$`, mark, math: 'inline' })
                                continue
                            }
                            for (const [k, b] of bit.split('**').entries()) {
                                if (k > 0) bold = !bold
                                if (b) pieces.push({ text: b, mark, ...(bold || heading ? { bold: true as const } : {}) })
                            }
                        }
                    })
                    if (pieces.length) words.push({ pieces, text: pieces.map(p => p.text).join('') })
                }
                if (words.length) out.push({ kind: 'text', words, gap: gap(), ...(heading ? { bold: true as const } : {}) })
            }
        }
    }
    return out
}

/** A line's words as runs of one style. The space before a word joins the run before it when that
 *  word starts a mark (the space stays untinted) and the word's own run otherwise; a formula keeps
 *  its run to itself, so its space is a run of its own. */
function runsOf(words: Word[]): TextRun[] {
    const runs: TextRun[] = []
    const same = (r: TextRun, p: Piece) => r.mark === p.mark && !r.math && !p.math && !!r.bold === !!p.bold
    words.forEach((word, wi) => {
        word.pieces.forEach((piece, pi) => {
            const last = runs[runs.length - 1]
            const spaced = wi > 0 && pi === 0
            const style = { mark: piece.mark, ...(piece.math ? { math: piece.math } : {}), ...(piece.bold ? { bold: piece.bold } : {}) }
            if (last && same(last, piece)) last.text += (spaced ? ' ' : '') + piece.text
            else if (!spaced) runs.push({ text: piece.text, ...style })
            else if (piece.mark && last && !last.math && !last.mark) {
                last.text += ' '
                runs.push({ text: piece.text, ...style })
            } else if (!piece.math) runs.push({ text: ` ${piece.text}`, ...style })
            else {
                const mark = piece.mark && !!last?.mark
                if (last && !last.math && last.mark === mark) last.text += ' '
                else runs.push({ text: ' ', mark })
                runs.push({ text: piece.text, ...style })
            }
        })
    })
    return runs
}

export function paginateText(
    blocks: { source: TextSource; text: string; placeholder?: true }[],
    page: { w: number; h: number },
    measure: TextMeasure,
    style: TextStyle = TEXT_STYLE(page),
    opts: { breakPerBlock?: boolean } = {},
): TextPage[] {
    const { fontPx, leading, margins } = style
    const text = typeof measure === 'function' ? (s: string) => measure(s) : measure.text
    const math = typeof measure === 'function' ? undefined : measure.math
    const boxOf = (tex: string, display: boolean): MathBox =>
        math ? math(tex, display) : { w: text(display ? `$$${tex}$$` : `$${tex}$`), ascent: fontPx * 0.8, descent: fontPx * 0.2 }
    const top = margins.top * page.h
    const bottom = page.h - margins.bottom * page.h
    const textW = page.w - (margins.inner + margins.outer) * page.w
    const space = text(' ')
    const widthOf = (w: Word) =>
        w.pieces.reduce((s, p) => s + (p.math ? boxOf(p.text.slice(1, -1), false).w : text(p.text, p.bold)), 0)
    const pages: TextPage[] = []
    let lines: TextLineBox[] = []
    let cursor = top
    const flush = () => {
        if (lines.length) pages.push({ lines, firstLeaf: lines[0].source.leaf })
        lines = []
        cursor = top
    }
    const leftEdge = () => ((pages.length + 1) % 2 === 1 ? margins.inner : margins.outer) * page.w
    /** Place a line `h` px tall whose baseline sits `rise` px below its top; a full page turns first. */
    const place = (h: number, rise: number, line: Omit<TextLineBox, 'y' | 'h' | 'x'> & { dx?: number }) => {
        if (lines.length && cursor + h > bottom + 0.5) flush()
        const { dx, ...rest } = line
        lines.push({ ...rest, x: leftEdge() + (dx ?? 0), y: cursor + rise, h })
        cursor += h
    }
    /** The space between paragraphs: half a line, as an ebook sets it. */
    const blank = () => {
        if (lines.length === 0) return // never at a page top
        if (cursor + leading * PARAGRAPH_GAP > bottom + 0.5) flush()
        else cursor += leading * PARAGRAPH_GAP
    }
    const emit = (words: Word[], source: TextSource, last: boolean, start: number, placeholder?: true) => {
        const gaps = words.length - 1
        const wordsW = words.reduce((s, w) => s + widthOf(w), 0)
        // A line too short to justify without gaping (few long words) is set ragged, as an ebook
        // sets it without hyphenation.
        const even = gaps > 0 ? (textW - wordsW) / gaps : space
        const gap = !last && gaps > 0 && even <= space * MAX_STRETCH ? even : space
        let above = 0
        let below = 0
        for (const w of words)
            for (const p of w.pieces)
                if (p.math) {
                    const b = boxOf(p.text.slice(1, -1), false)
                    above = Math.max(above, b.ascent - fontPx * 0.9)
                    below = Math.max(below, b.descent - (leading - fontPx))
                }
        const h = leading + Math.max(0, above) + Math.max(0, below)
        place(h, fontPx + Math.max(0, above), { runs: runsOf(words), gap, source, last, start, ...(placeholder ? { placeholder } : {}) })
    }
    for (const block of blocks) {
        // a block (a notebook page) starts a new text page, when asked
        if (opts.breakPerBlock) flush()
        let offset = 0
        for (const para of parse(block.text)) {
            if (para.gap === 'blank') blank()
            if (para.kind === 'display') {
                const b = boxOf(para.tex, true)
                const pad = leading * 0.25
                const k = b.w > textW ? textW / b.w : 1
                place((b.ascent + b.descent) * k + pad * 2, pad + b.ascent * k, {
                    runs: [{ text: `$$${para.tex}$$`, mark: para.mark, math: 'display' }],
                    gap: space,
                    source: block.source,
                    last: true,
                    start: offset,
                    dx: Math.max(0, (textW - b.w * k) / 2),
                    ...(k < 1 ? { scale: k } : {}),
                    ...(block.placeholder ? { placeholder: block.placeholder } : {}),
                })
                offset += 1
                continue
            }
            let line: Word[] = []
            let lineStart = offset
            for (const word of para.words) {
                const next = [...line, word].reduce((s, w) => s + widthOf(w), 0) + space * line.length
                if (line.length > 0 && next > textW) {
                    emit(line, block.source, false, lineStart, block.placeholder)
                    lineStart += line.length
                    line = [word]
                } else line.push(word)
            }
            if (line.length) emit(line, block.source, true, lineStart, block.placeholder)
            offset += para.words.length
        }
        // the blank line between blocks (notebook pages) and between paragraphs of one block
        blank()
    }
    flush()
    return pages
}

/** First text page showing that leaf's text; 0 when none does. */
export function textPageForLeaf(pages: TextPage[], leaf: number): number {
    const i = pages.findIndex(p => p.lines.some(l => l.source.leaf === leaf))
    return i < 0 ? 0 : i
}

/** The leaf a text page's first line came from; 0 when the page does not exist. */
export function leafForTextPage(pages: TextPage[], textPage: number): number {
    return pages[textPage]?.firstLeaf ?? 0
}

/** The notebook leaf a reader on these text pages is on: the first leaf whose text begins on them
 *  (pages in the order given), else the leaf of their first line; `fallback` when they hold no line.
 *  A page's first line is usually the tail of the previous notebook page, so that line alone would
 *  send the reader one page back. */
export function leafOnTextPages(pages: TextPage[], indices: (number | undefined)[], fallback = 0): number {
    let first: number | undefined
    for (const i of indices) {
        if (i === undefined) continue
        for (const l of pages[i]?.lines ?? []) {
            first ??= l.source.leaf
            if (l.start === 0) return l.source.leaf
        }
    }
    return first ?? fallback
}

/** The text page holding that leaf's word: the last page whose first line from that leaf starts at or before `word`; 0 when the leaf has no text. */
export function textPageForWord(pages: TextPage[], leaf: number, word: number): number {
    let found = 0
    for (let i = 0; i < pages.length; i++) {
        const first = pages[i].lines.find(l => l.source.leaf === leaf)
        if (!first) continue
        if (first.start > word) break
        found = i
    }
    return found
}
