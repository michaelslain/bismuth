import { describe, expect, test } from 'bun:test'
import { TEXT_STYLE, leafForTextPage, leafOnTextPages, paginateText, textPageForLeaf, textPageForWord, type TextLineBox } from './bookText'

const measure = (s: string) => s.length * 7
const page = { w: 300, h: 400 }
const src = (leaf: number) => ({ file: 'a.pdf', pdfPage: leaf, leaf })
const lorem = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
const textW = (p = page) => {
    const m = TEXT_STYLE(p).margins
    return p.w - (m.inner + m.outer) * p.w
}
const lineText = (l: TextLineBox) => l.runs.map(r => r.text).join('')
const words = (l: TextLineBox) => lineText(l).split(/\s+/).filter(Boolean)

describe('paginateText', () => {
    test('lines never exceed the text width', () => {
        const pages = paginateText([{ source: src(1), text: lorem }], page, measure)
        for (const p of pages) for (const l of p.lines) expect(measure(lineText(l).trim())).toBeLessThanOrEqual(textW())
    })

    test('non-last lines fill the width exactly, a last line uses the natural space', () => {
        const pages = paginateText([{ source: src(1), text: lorem }], page, measure)
        const lines = pages.flatMap(p => p.lines)
        expect(lines.length).toBeGreaterThan(2)
        for (const l of lines) {
            const ws = words(l)
            const wordsW = ws.reduce((s, w) => s + measure(w), 0)
            if (l.last) expect(l.gap).toBe(measure(' '))
            else expect(wordsW + l.gap * (ws.length - 1)).toBeCloseTo(textW(), 6)
        }
        expect(lines[lines.length - 1].last).toBe(true)
    })

    test('marks become mark runs covering exactly the marked words, across lines', () => {
        const text = `${lorem} ==${lorem}== tail`
        const lines = paginateText([{ source: src(1), text }], page, measure).flatMap(p => p.lines)
        const marked = lines.flatMap(l => l.runs.filter(r => r.mark).map(r => r.text.trim())).join(' ')
        expect(marked).toBe(lorem)
        expect(lines.map(lineText).join(' ')).not.toContain('==')
        expect(lines.filter(l => l.runs.some(r => r.mark)).length).toBeGreaterThan(1)
        const small = paginateText([{ source: src(1), text: 'x ==a b== y' }], page, measure)[0].lines[0]
        expect(small.runs.filter(r => r.mark).map(r => r.text)).toEqual(['a b'])
    })

    test('a stray == is plain text and does not tint the rest', () => {
        const run = (text: string) => paginateText([{ source: src(1), text }], page, measure)[0].lines.flatMap(l => l.runs)
        const stray = run('a == b and c == d')
        expect(stray.some(r => r.mark)).toBe(false)
        expect(stray.map(r => r.text).join('')).toContain('==')
        expect(run('a ==b c').some(r => r.mark)).toBe(false)
    })

    test('odd pages put the inner margin on the left, even pages the outer', () => {
        const long = Array.from({ length: 12 }, () => lorem).join('\n\n')
        const pages = paginateText([{ source: src(1), text: long }], page, measure)
        expect(pages.length).toBeGreaterThan(2)
        const m = TEXT_STYLE(page).margins
        expect(pages[0].lines[0].x).toBeCloseTo(m.inner * page.w, 6)
        expect(pages[1].lines[0].x).toBeCloseTo(m.outer * page.w, 6)
        expect(pages[2].lines[0].x).toBeCloseTo(m.inner * page.w, 6)
    })

    test('y is the baseline of line i', () => {
        const s = TEXT_STYLE(page)
        const l = paginateText([{ source: src(1), text: lorem }], page, measure)[0].lines
        expect(l[0].y).toBeCloseTo(s.margins.top * page.h + s.fontPx, 6)
        expect(l[1].y - l[0].y).toBeCloseTo(s.leading, 6)
    })

    test('leaf lookups round-trip', () => {
        const blocks = [1, 2, 3, 4].map(leaf => ({ source: src(leaf), text: `${lorem}\n\n${lorem}` }))
        const pages = paginateText(blocks, page, measure)
        for (let i = 0; i < pages.length; i++) expect(textPageForLeaf(pages, leafForTextPage(pages, i))).toBeLessThanOrEqual(i)
        for (const leaf of [1, 2, 3, 4]) {
            const i = textPageForLeaf(pages, leaf)
            expect(pages[i].lines.some(l => l.source.leaf === leaf)).toBe(true)
        }
        expect(textPageForLeaf(pages, 99)).toBe(0)
    })

    test('the leaf a reader is on is the one whose text begins on the pages, not the tail of the one before', () => {
        const blocks = [1, 2, 3, 4].map(leaf => ({ source: src(leaf), text: `${lorem}\n\n${lorem}` }))
        const pages = paginateText(blocks, page, measure)
        for (const leaf of [2, 3, 4]) {
            const i = textPageForLeaf(pages, leaf)
            // the page where `leaf` starts opens with the previous leaf's tail
            expect(pages[i].lines[0].source.leaf).toBe(leaf - 1)
            expect(leafForTextPage(pages, i)).toBe(leaf - 1)
            expect(leafOnTextPages(pages, [i])).toBe(leaf)
            // entering text at `leaf` and coming back lands on `leaf`, every time
            expect(leafOnTextPages(pages, [textPageForLeaf(pages, leafOnTextPages(pages, [i]))])).toBe(leaf)
        }
    })

    test('a page that starts no leaf reads as the leaf of its first line; nothing at all is the fallback', () => {
        const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')
        const pages = paginateText([{ source: src(7), text: long }], page, measure)
        expect(pages.length).toBeGreaterThan(2)
        expect(leafOnTextPages(pages, [1, 2])).toBe(7)
        expect(leafOnTextPages(pages, [undefined, 99], 5)).toBe(5)
    })

    test('identical inputs give identical output', () => {
        const a = paginateText([{ source: src(1), text: `${lorem} ==x==` }], page, measure)
        const b = paginateText([{ source: src(1), text: `${lorem} ==x==` }], page, measure)
        expect(a).toEqual(b)
    })

    test('empty text contributes no lines', () => {
        expect(paginateText([{ source: src(1), text: '' }], page, measure)).toEqual([])
        const pages = paginateText([{ source: src(1), text: '  \n\n ' }, { source: src(2), text: 'hi there' }], page, measure)
        expect(pages.flatMap(p => p.lines).every(l => l.source.leaf === 2)).toBe(true)
        expect(pages[0].firstLeaf).toBe(2)
    })

    test('start rises within a block and resets per block', () => {
        const blocks = [1, 2].map(leaf => ({ source: src(leaf), text: `${lorem}\n\n${lorem}` }))
        const lines = paginateText(blocks, page, measure).flatMap(p => p.lines)
        for (const leaf of [1, 2]) {
            const ls = lines.filter(l => l.source.leaf === leaf)
            expect(ls[0].start).toBe(0)
            for (let i = 1; i < ls.length; i++) expect(ls[i].start).toBeGreaterThan(ls[i - 1].start)
            expect(ls[ls.length - 1].start + words(ls[ls.length - 1]).length).toBe(120)
        }
    })

    test('textPageForWord keeps a word on screen across a resize', () => {
        const blocks = [1, 2, 3, 4].map(leaf => ({ source: src(leaf), text: Array.from({ length: 5 }, () => lorem).join('\n\n') }))
        const small = paginateText(blocks, page, measure)
        const big = paginateText(blocks, { w: 360, h: 480 }, measure)
        const mid = small[Math.floor(small.length / 2)].lines[0]
        const i = textPageForWord(big, mid.source.leaf, mid.start)
        expect(big[i].lines.some(l => l.source.leaf === mid.source.leaf && l.start <= mid.start && mid.start < l.start + words(l).length)).toBe(true)
        expect(textPageForWord(big, 99, 5)).toBe(0)
    })

    test('a placeholder block is one paragraph that keeps its leaf mapping and flags its lines', () => {
        const blocks = [
            { source: src(0), text: lorem },
            { source: src(1), text: "page 2 isn't transcribed yet", placeholder: true as const },
            { source: src(2), text: lorem },
        ]
        const pages = paginateText(blocks, page, measure)
        const lines = pages.flatMap(p => p.lines)
        const holder = lines.filter(l => l.source.leaf === 1)
        expect(holder.length).toBeGreaterThan(0)
        expect(holder.every(l => l.placeholder === true)).toBe(true)
        expect(holder.map(lineText).join(' ')).toBe("page 2 isn't transcribed yet")
        expect(holder[holder.length - 1].last).toBe(true)
        expect(lines.filter(l => l.source.leaf !== 1).some(l => l.placeholder)).toBe(false)
        const at = textPageForLeaf(pages, 1)
        expect(pages[at].lines.some(l => l.source.leaf === 1)).toBe(true)
        expect(leafForTextPage(pages, at)).toBeLessThanOrEqual(1)
    })

    describe('math and markdown', () => {
        // a formula is 10 px a character of source, 30 px tall above the baseline and 10 below
        const mathMeasure = {
            text: (s: string, bold?: boolean) => s.length * (bold ? 8 : 7),
            math: (tex: string, display: boolean) => ({ w: tex.length * 10, ascent: display ? 40 : 30, descent: display ? 20 : 10 }),
        }
        const linesOf = (text: string, m: Parameters<typeof paginateText>[2] = mathMeasure) =>
            paginateText([{ source: src(1), text }], page, m).flatMap(p => p.lines)

        test('inline math is one word, however many spaces it holds, and quotes its source', () => {
            const [line] = linesOf('so $a + b = c$ holds')
            expect(line.runs.map(r => [r.text, r.math ?? null])).toEqual([
                ['so ', null],
                ['$a + b = c$', 'inline'],
                [' holds', null],
            ])
            expect(lineText(line)).toBe('so $a + b = c$ holds')
        })

        test('a tall formula makes its line taller, and the next line moves down by that much', () => {
            const s = TEXT_STYLE(page)
            const [a, b] = linesOf('tall $x$\nnext line')
            const top = s.margins.top * page.h
            expect(a.h).toBeGreaterThan(s.leading)
            expect(a.y).toBeCloseTo(top + s.fontPx + (30 - s.fontPx * 0.9), 6)
            // the next line starts below the whole of the tall one
            expect(b.y).toBeCloseTo(top + a.h + s.fontPx, 6)
        })

        test('display math is a centred line of its own with its source as one run', () => {
            const lines = linesOf('Claim\n$$\\lim s_n = 0$$\nproof')
            expect(lines.map(lineText)).toEqual(['Claim', '$$\\lim s_n = 0$$', 'proof'])
            const d = lines[1]
            expect(d.runs).toEqual([{ text: '$$\\lim s_n = 0$$', mark: false, math: 'display' }])
            const left = TEXT_STYLE(page).margins.inner * page.w
            expect(d.x).toBeCloseTo(left + (textW() - '\\lim s_n = 0'.length * 10) / 2, 6)
            expect(d.h).toBeGreaterThan(40 + 20)
        })

        test('a display formula wider than the text shrinks to fit, centred at its new width', () => {
            const tex = 'x'.repeat(40) // 400 px against 240 px of text
            const [d] = linesOf(`$$${tex}$$`)
            expect(d.scale).toBeCloseTo(textW() / 400, 6)
            expect(d.x).toBeCloseTo(TEXT_STYLE(page).margins.inner * page.w, 6)
            expect(d.h).toBeCloseTo((40 + 20) * d.scale! + TEXT_STYLE(page).leading * 0.5, 6)
        })

        test('wrapped prose rejoins; claims, formulas and headings keep their breaks', () => {
            const prose = linesOf('I went to the woods\nso I', measure)
            expect(prose.map(lineText)).toEqual(['I went to the woods so I'])
            const notes = linesOf('Claim\nProof\nlet $e > 0$\nthen done.\nnext')
            expect(notes.map(lineText)).toEqual(['Claim', 'Proof', 'let $e > 0$', 'then done.', 'next'])
        })

        test('a heading and **bold** are bold runs without their markers', () => {
            const lines = linesOf('## Limit\nsee **this** here')
            expect(lines[0].runs).toEqual([{ text: 'Limit', mark: false, bold: true }])
            expect(lines[1].runs.map(r => [r.text, !!r.bold])).toEqual([
                ['see', false],
                [' this', true],
                [' here', false],
            ])
        })

        test('a line that would gape when justified is set ragged instead', () => {
            // two long words: justifying them would open a gap many spaces wide
            const [first] = paginateText([{ source: src(1), text: `${'x'.repeat(14)} ${'y'.repeat(14)} ${'z'.repeat(14)}` }], page, measure)[0].lines
            expect(first.gap).toBe(measure(' '))
        })

        test('with a break per block each block starts a new page', () => {
            const blocks = [1, 2, 3].map(leaf => ({ source: src(leaf), text: 'short note' }))
            const pages = paginateText(blocks, page, measure, TEXT_STYLE(page), { breakPerBlock: true })
            expect(pages.map(p => p.firstLeaf)).toEqual([1, 2, 3])
            expect(paginateText(blocks, page, measure)).toHaveLength(1)
        })

        test('a larger font scale sets fewer words a line and more pages', () => {
            const text = Array.from({ length: 6 }, () => lorem).join('\n\n')
            const at = (scale: number) => paginateText([{ source: src(1), text }], page, (w: string) => w.length * 7 * scale, TEXT_STYLE(page, scale)).length
            expect(TEXT_STYLE(page, 1.5).fontPx).toBeGreaterThan(TEXT_STYLE(page).fontPx)
            expect(at(1.5)).toBeGreaterThan(at(1))
        })
    })
})
