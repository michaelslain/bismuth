// app/src/export/htmlTemplate.test.ts
import { test, expect, describe } from 'bun:test'
import { wrapHtmlDocument, RULE_PX } from './htmlTemplate'
import { DEFAULT_PALETTE, PROSE_SCALE } from './exportTheme'
import { renderMarkdown } from '../bases/markdown'

describe('wrapHtmlDocument', () => {
    test('produces a full html doc with the body inlined', () => {
        const out = wrapHtmlDocument('<p>hi</p>', 'My Note')
        expect(out).toContain('<!doctype html>')
        expect(out).toContain('<title>My Note</title>')
        expect(out).toContain('<p>hi</p>')
        expect(out).toContain('<style>')
    })
    test('escapes the title', () => {
        const out = wrapHtmlDocument('', `A & B <x>`)
        expect(out).toContain('<title>A &amp; B &lt;x&gt;</title>')
        expect(out).not.toContain('<title>A & B <x></title>')
    })

    test('omits an explicit body font-size when none is requested (intrinsic sizing)', () => {
        // Narrowed to the PDF-only conditional rule specifically (pt units) — the stylesheet
        // legitimately carries other unconditional font-size rules (.fmatter, .pagefoot) that
        // have nothing to do with fontSizePt, so a blanket "no font-size anywhere" assertion
        // would be testing the wrong thing.
        const out = wrapHtmlDocument('<p>hi</p>', 'N')
        expect(out).not.toMatch(/font-size:\s*\d+pt/)
    })

    test('emits the requested body font-size (pt) when given', () => {
        expect(wrapHtmlDocument('<p>hi</p>', 'N', undefined, '', 12)).toContain(
            'font-size: 12pt',
        )
        expect(wrapHtmlDocument('<p>hi</p>', 'N', undefined, '', 18)).toContain(
            'font-size: 18pt',
        )
    })

    // GitHub issue #9, defect 2: a horizontal ruled-paper background painted a line under every
    // row of text in every export. The repo owner first asked to scope removal to the PDF path
    // only, then broadened it mid-task ("lets not just scope it to pdf but all formats!") — so
    // there is no format-conditional here, just an unconditional absence of the background.
    test('no export document ever carries the ruled-paper background (removed for every format)', () => {
        const out = wrapHtmlDocument('<p>hi</p>', 'N')
        expect(out).not.toContain('linear-gradient')
        expect(out).not.toMatch(/background-size:\s*100%\s*\d+px/)
    })

    // The 22px text-baseline grid is a SEPARATE thing from the visible rules and must survive
    // their removal — defect 1's page-slicing fix (pageGeometry.ts pdfSliceMetrics) snaps page
    // height to whole multiples of this exact grid, so it staying intact is load-bearing, not
    // cosmetic.
    test('the 22px line-height baseline grid survives the ruled-background removal', () => {
        const out = wrapHtmlDocument('<p>hi</p>', 'N')
        expect(out).toContain(`line-height: ${RULE_PX}px`)
    })
})

// Change A: the "## "/"### "/…/"###### " markers before h2-h6 are opt-in (ExportOptions.
// showMarkdownSyntax), default off. wrapHtmlDocument's 7th positional param carries the flag.
// Asserting on the actual `content: "## "` declarations (not a proxy) so a bug that inverts the
// condition breaks ONE of the two tests below: default-off asserts absence, flag-on asserts
// presence — an inverted `showMarkdownSyntax ? "" : rule` would fail the second test instead.
describe('markdown-syntax markers (h2-h6 ::before, opt-in)', () => {
    test('default: no markdown-syntax marker CSS at all', () => {
        const out = wrapHtmlDocument('<h2>x</h2>', 'N')
        expect(out).not.toContain('content: "## "')
        expect(out).not.toContain('content: "### "')
        expect(out).not.toContain('content: "#### "')
        expect(out).not.toContain('content: "##### "')
        expect(out).not.toContain('content: "###### "')
    })

    test('flag on: all five marker declarations are present', () => {
        // Positional: body, title, palette, extraHead, fontSizePt, page, showMarkdownSyntax.
        const out = wrapHtmlDocument(
            '<h2>x</h2>',
            'N',
            undefined,
            '',
            undefined,
            true,
        )
        expect(out).toContain('content: "## "')
        expect(out).toContain('content: "### "')
        expect(out).toContain('content: "#### "')
        expect(out).toContain('content: "##### "')
        expect(out).toContain('content: "###### "')
    })
})

// Change B (GitHub issue #9 follow-up): `pre` and `.callout` were the two blocks NOT pinned to
// the RULE_PX baseline grid, so a code block or callout could push everything below it off the
// grid pdfSliceMetrics snaps page breaks to. These are STRING assertions on the generated CSS —
// they prove the declared numbers are correct and grid-aligned, but bun test can't lay out a
// real DOM/canvas here, so this does NOT prove html2canvas's actual rendered box geometry lands
// on the grid end to end.
describe('pre / .callout stay on the RULE_PX baseline grid (GitHub issue #9 follow-up)', () => {
    test('pre: vertical margin and vertical padding are each a whole (nonzero) multiple of RULE_PX, in px', () => {
        const out = wrapHtmlDocument('<pre>x</pre>', 'N')
        const preRule = /pre\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        const margin = /margin:\s*(\d+)px\s+0/.exec(preRule)
        const padding = /padding:\s*(\d+)px\s+1rem/.exec(preRule)
        expect(margin).not.toBeNull()
        expect(padding).not.toBeNull()
        const marginV = Number(margin![1]) * 2 // shorthand "Xpx 0" -> top + bottom
        const paddingV = Number(padding![1]) * 2
        expect(marginV).toBeGreaterThan(0)
        expect(paddingV).toBeGreaterThan(0)
        expect(marginV % RULE_PX).toBe(0)
        expect(paddingV % RULE_PX).toBe(0)
    })

    test('pre keeps background/border-radius/overflow/white-space/word-break/line-height untouched', () => {
        const out = wrapHtmlDocument('<pre>x</pre>', 'N')
        const preRule = /pre\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        expect(preRule).toContain('border-radius: 6px')
        expect(preRule).toContain('overflow: auto')
        expect(preRule).toContain('white-space: pre-wrap')
        expect(preRule).toContain('word-break: break-word')
        expect(preRule).toMatch(new RegExp(`line-height:\\s*${RULE_PX}px`))
    })

    test(".callout: border-top + padding-top + padding-bottom + border-bottom + callout-content's margin-top sum to a whole (nonzero) multiple of RULE_PX, in px", () => {
        const out = wrapHtmlDocument('<p>x</p>', 'N')
        const calloutRule = /\.callout\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        const contentRule = /\.callout-content\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        const border = /border:\s*(\d+)px/.exec(calloutRule)
        const padding = /padding:\s*(\d+)px\s+[\d.]+em/.exec(calloutRule)
        const gap = /margin-top:\s*(\d+)px/.exec(contentRule)
        expect(border).not.toBeNull()
        expect(padding).not.toBeNull()
        expect(gap).not.toBeNull()
        const borderPx = Number(border![1])
        const paddingPx = Number(padding![1])
        const gapPx = Number(gap![1])
        const total = borderPx + paddingPx + paddingPx + borderPx + gapPx
        expect(total).toBeGreaterThan(0)
        expect(total % RULE_PX).toBe(0)
    })

    test('.callout: vertical values are px (not em), so the grid math is IDENTICAL at every PDF_FONT_SIZES entry', () => {
        // fontSizePt only affects em-relative descendant sizing (the PDF path's body font size);
        // pre/.callout's vertical rhythm must not move at all when it changes — proving the fix
        // doesn't merely work at the default 12pt by coincidence, the exact shape of the original bug.
        const sizes = [9, 10, 11, 12, 14, 16, 18] // PDF_FONT_SIZES (app/src/export/options.ts)
        const calloutRules = sizes.map(pt => {
            const out = wrapHtmlDocument('<p>x</p>', 'N', undefined, '', pt)
            return /\.callout\s*\{[^}]*\}/.exec(out)?.[0]
        })
        const preRules = sizes.map(pt => {
            const out = wrapHtmlDocument('<pre>x</pre>', 'N', undefined, '', pt)
            return /pre\s*\{[^}]*\}/.exec(out)?.[0]
        })
        expect(new Set(calloutRules).size).toBe(1) // byte-identical .callout rule at every size
        expect(new Set(preRules).size).toBe(1) // byte-identical pre rule at every size
        // Not em/em, which was the original bug shape (padding: 0.55em 0.85em).
        expect(calloutRules[0]).not.toMatch(/padding:\s*[\d.]+em\s+[\d.]+em/)
    })

    test('pre and .callout keep their other deliberate design untouched (border-radius, border-left-width, background, horizontal padding)', () => {
        const out = wrapHtmlDocument('<p>x</p>', 'N')
        const calloutRule = /\.callout\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        expect(calloutRule).toContain('border-left-width: 4px')
        expect(calloutRule).toContain('border-radius: 6px')
        expect(calloutRule).toContain('0.85em') // horizontal padding unchanged
        expect(calloutRule).toContain('rgba(127,127,127,0.06)') // background unchanged
    })
})

describe('prose documents carry the app typography (settings-driven)', () => {
    // proseLeading 1.5 against a 12pt body (16px): one prose line box is round(16 * 1.5) = 24px.
    const p = {
        ...DEFAULT_PALETTE.dark,
        font: 'UiMono, monospace',
        proseFont: "'Lora Variable', Lora, Georgia, serif",
        proseLeading: 1.5,
    }
    const doc = (
        palette = p,
        prose = true,
        pt: number | undefined = 12,
    ): string =>
        wrapHtmlDocument(
            '<p>x</p>',
            'n',
            palette,
            '',
            pt,
            false,
            prose,
        )

    test('a prose document uses the prose face, not the UI face', () => {
        expect(doc()).toContain("'Lora Variable', Lora, Georgia, serif")
    })

    test('a non-prose document keeps the UI face (base/calendar exports unchanged)', () => {
        const out = doc(p, false)
        expect(out).not.toContain("'Lora Variable'")
        expect(out).toContain('UiMono, monospace')
        expect(out).toContain(`line-height: ${RULE_PX}px`)
    })

    test('prose leading is a ratio OF THE TYPE, not a multiple of RULE_PX', () => {
        // The trap this pins: editor.lineHeight is a multiple of the app's 18px row unit. Reusing
        // that number against the 22px export rule left a 20px serif on 22px of leading — a 1.07
        // ratio, tight enough that adjacent line boxes physically overlap.
        expect(doc()).toContain('line-height: 24px')
        expect(doc()).not.toContain(`line-height: ${RULE_PX}px`)
    })

    test('a different leading moves every prose line box with it', () => {
        expect(doc({ ...p, proseLeading: 1.9 })).toContain('line-height: 30px')
    })

    test('leading tracks the chosen point size, so 18pt is not set on 12pt leading', () => {
        // 18pt = 24px; 24 * 1.5 = 36px.
        expect(doc(p, true, 18)).toContain('line-height: 36px')
    })

    test('the chosen point size is used literally — the prose scale is NOT applied', () => {
        // The picker means "body text at this size". Multiplying it by --prose-scale would make a
        // chosen 12pt silently render at 15.36pt.
        const bodyRule = /\n  body \{[^}]*\}/.exec(doc())?.[0] ?? ''
        expect(bodyRule).toContain('font-size: 12pt')
        // Exactly ONE font-size on <body>. A second `font-size: <scale>em` would win outright and
        // resolve against <html> (16px), discarding the chosen pt at every size but 12.
        expect(bodyRule.match(/font-size:/g)).toHaveLength(1)
        expect(/\n  body \{[^}]*\}/.exec(doc(p, true, 9))?.[0]).toContain(
            'font-size: 9pt',
        )
    })

    test('the callout box still sums to a whole line at a non-default leading', () => {
        const out = doc()
        const calloutRule = /\.callout\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        const gapRule = /\.callout-content\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        const pad = parseFloat(
            /padding:\s*([\d.]+)px/.exec(calloutRule)?.[1] ?? '0',
        )
        const gap = parseFloat(
            /margin-top:\s*([\d.]+)px/.exec(gapRule)?.[1] ?? '0',
        )
        expect(2 * 1 + 2 * pad + gap).toBe(24)
    })
})

describe('inline KaTeX math participates in line-box height (task 1 fix)', () => {
    // The inlined KaTeX stylesheet (katexCss.ts) leaves .katex at the library default
    // display: inline for an inline formula, which contributes only its OWN line-height to the
    // surrounding line box, never its ink — so a tall fraction/sum paints straight over the line
    // below it (measured up to ~47px of ink inside a 25px line box at default leading). Giving
    // .katex a display that participates in box height (inline-block) turns the line-height into
    // a floor instead of a ceiling: the browser grows the line box to fit the formula.
    test('.katex is given a display that actually participates in line-box height', () => {
        // An allow-list, not a deny-list: "not inline" alone would also pass display: none
        // (which deletes the formula from the page) and display: contents (which generates no
        // box at all, so no line box can grow to fit it) — both are the exact failure this task
        // fixes, just via a different mechanism than the original bug. The criterion is
        // two-part: the value must (1) generate a box whose height participates in the line box,
        // AND (2) have outer display INLINE, so the formula stays embedded in its sentence
        // rather than forcing a line break before/after itself. block/flow-root/table satisfy
        // (1) but fail (2) — per the CSS Display spec they all have outer display: block, so
        // `.katex { display: block }` would split "the value $x^2$ is squared" onto its own
        // line, a different visual break than the one this task fixes but a break all the same.
        // Only the inline-level box-generating values satisfy both; inline-block is what ships.
        const LINE_BOX_PARTICIPATING_INLINE_DISPLAYS = [
            'inline-block',
            'inline-flex',
            'inline-table',
            'inline-grid',
        ]
        const out = wrapHtmlDocument('<p>x</p>', 'N')
        const katexRule = /\.katex\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        expect(katexRule).not.toBe('')
        const display = /display:\s*([a-z-]+)/.exec(katexRule)?.[1]
        expect(LINE_BOX_PARTICIPATING_INLINE_DISPLAYS).toContain(display)
    })

    test('.katex keeps the default baseline alignment (no vertical-align override)', () => {
        // inline-block's own default is vertical-align: baseline. Setting "middle" here would
        // visibly shift every inline formula off the text baseline mid-sentence — the stop
        // condition this task's brief calls out explicitly.
        const out = wrapHtmlDocument('<p>x</p>', 'N')
        const katexRule = /\.katex\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        expect(katexRule).not.toContain('vertical-align')
    })
})

describe('a blank line in the note renders as blank space (task 2 fix)', () => {
    // The shared markdown renderer runs with breaks: true (bases/markdown.ts), so a single
    // newline becomes <br> inside one <p>, and only a BLANK line ends the paragraph and starts a
    // new one. Before this fix, p had margin: 0, so that paragraph break contributed zero
    // vertical space and a blank line read identically to a plain line break. A bottom margin of
    // exactly one rule (the same baseline unit the rest of the stylesheet is built on — RULE_PX
    // for non-prose, proseLeading's derived rule for prose) makes a blank line worth one blank
    // line. Asserted at two different proseLeading values so this tracks the rule, not a
    // hardcoded pixel count.
    const p = {
        ...DEFAULT_PALETTE.dark,
        font: 'UiMono, monospace',
        proseFont: "'Lora Variable', Lora, Georgia, serif",
    }
    const pRule = (palette: typeof p, pt = 12): string => {
        const out = wrapHtmlDocument(
            '<p>x</p>',
            'n',
            palette,
            '',
            pt,
            false,
            true,
        )
        return /\n  p \{[^}]*\}/.exec(out)?.[0] ?? ''
    }

    test('a paragraph carries a non-zero bottom margin equal to one rule, at proseLeading 1.5', () => {
        // 12pt body = 16px; round(16 * 1.5) = 24px.
        const rule = pRule({ ...p, proseLeading: 1.5 })
        expect(rule).toContain('margin: 0 0 24px')
    })

    test('a paragraph carries a non-zero bottom margin equal to one rule, at a different proseLeading', () => {
        // 12pt body = 16px; round(16 * 1.9) = 30px — a different leading must move the margin
        // with it, exactly like it moves line-height (see the leading test above).
        const rule = pRule({ ...p, proseLeading: 1.9 })
        expect(rule).toContain('margin: 0 0 30px')
    })

    test('list items keep zero margin — blank-line spacing is a paragraph concern, not a list one', () => {
        const rule = /\n  li \{[^}]*\}/.exec(
            wrapHtmlDocument('<p>x</p>', 'N'),
        )?.[0] ?? ''
        expect(rule).toContain('margin: 0;')
    })

    test('the callout footprint still sums to a whole rule after the paragraph-margin change', () => {
        // Guards against a regression where a change to the shared styles() function accidentally
        // moved calloutGap's derivation. Non-prose, default RULE_PX.
        const out = wrapHtmlDocument('<p>x</p>', 'N')
        const calloutRule = /\.callout\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        const contentRule = /\.callout-content\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        const border = Number(/border:\s*(\d+)px/.exec(calloutRule)?.[1] ?? 0)
        const padding = Number(
            /padding:\s*(\d+)px\s+[\d.]+em/.exec(calloutRule)?.[1] ?? 0,
        )
        const gap = Number(/margin-top:\s*(\d+)px/.exec(contentRule)?.[1] ?? 0)
        const total = 2 * border + 2 * padding + gap
        expect(total).toBeGreaterThan(0)
        expect(total % RULE_PX).toBe(0)
    })
})

// --- a loose list must not gain a full rule of dead space after every item (finding 1) --------
// A "loose" markdown list (blank line between items) wraps each item's text in its own <p> —
// marked's own loose-list handling, exercised here through the real shared renderer, not a hand
// -written <li><p> fixture. Without li > p:last-child, that <p> inherits the same trailing-rule
// bottom margin prose paragraphs get, so the same visual list gains a full rule of space after
// every item (including the last) purely from invisible blank lines in the source.
describe('a loose markdown list does not gain a rule of trailing space per item (finding 1)', () => {
    test('renderMarkdown actually produces li > p for a loose list, and li directly for a tight one', () => {
        // Guards the premise of the tests below: if marked ever stops loose-wrapping list items,
        // these assertions would pass vacuously.
        expect(renderMarkdown('- a\n\n- b')).toContain('<li><p>a</p>')
        expect(renderMarkdown('- a\n- b')).not.toContain('<p>')
    })

    test('a loose list item\'s paragraph carries zero bottom margin, same as a tight item', () => {
        const loose = wrapHtmlDocument(renderMarkdown('- a\n\n- b'), 'N')
        const rule = /li\s*>\s*p:last-of-type\s*\{[^}]*\}/.exec(loose)?.[0] ?? ''
        expect(rule).toContain('margin-bottom: 0')
    })

    test('the selector is :last-of-type, so a NESTED list after the paragraph does not strand it', () => {
        // :last-child missed this: when the item's paragraph is followed by a nested <ul>, the
        // list is the last CHILD, so the paragraph kept a full rule of dead space before the
        // sublist (measured 30px in Chrome). :last-of-type still means "the final paragraph in
        // this item", which is what the rule was always trying to express.
        const html = renderMarkdown('- top text\n\n  - nested a\n  - nested b')
        expect(html).toContain('<li><p>top text</p>')
        expect(html).toMatch(/<p>top text<\/p>\s*<ul>/)
        const out = wrapHtmlDocument(html, 'N')
        expect(out).toContain('li > p:last-of-type')
        expect(out).not.toContain('li > p:last-child')
    })

    test('a multi-paragraph list item still separates its own paragraphs by one rule', () => {
        // Two paragraphs inside one list item — the first must keep its rule of trailing space
        // (li > p:last-of-type only zeroes the LAST paragraph), or the item's own paragraphs would
        // collapse into each other.
        const html = renderMarkdown('- first para\n\n  second para')
        expect(html).toContain('<li><p>first para</p>')
        expect(html).toContain('<p>second para</p>')
        const out = wrapHtmlDocument(html, 'N')
        const pRule = /(?:^|[\s}])p\s*\{[^}]*\}/.exec(out)?.[0] ?? ''
        expect(pRule).toMatch(/margin: 0 0 \d+px/)
    })
})

// --- the export uses the APP's heading scale, not the browser's defaults ----------------------
// An exported note used to set no heading font-size at all, so every level fell back to the UA
// stylesheet — a different ramp AND a different shape from the app's. These assert the app's
// RELATIONSHIPS rather than literal pixel values, so they keep meaning when a vault changes
// appearance.editorFontSize; a literal would just be re-blessed on every settings change.
describe('exported headings follow the app scale (editor/livePreview.ts + tokens.css)', () => {
    const emit = (pt: number, leading: number) =>
        wrapHtmlDocument(
            '<p>x</p>',
            'N',
            { ...DEFAULT_PALETTE.dark, proseLeading: leading },
            '',
            pt,
            false,
            true, // prose: the rendered-note path
        )
    const sizeOf = (css: string, tag: string): number => {
        const m = new RegExp(`\\b${tag} \\{[^}]*font-size:\\s*([\\d.]+)px`).exec(css)
        expect(m).not.toBeNull()
        return Number(m![1])
    }

    for (const [label, pt] of [
        ['10pt', 10],
        ['18pt', 18],
    ] as const) {
        test(`h3 and h4 sit AT body size and h5/h6 at or below it — ${label}`, () => {
            const css = emit(pt, 1.25)
            const editorFontSize = (pt * 96) / 72 // the document's own body size
            // The shape that distinguishes the app's ramp from the browser's: h3 is NOT bigger
            // than body. Under the UA defaults it is 1.17em, which is what this catches.
            expect(sizeOf(css, 'h3')).toBe(editorFontSize)
            expect(sizeOf(css, 'h4')).toBe(editorFontSize)
            expect(sizeOf(css, 'h5')).toBeLessThanOrEqual(editorFontSize)
            expect(sizeOf(css, 'h6')).toBeLessThanOrEqual(editorFontSize)
            // h1/h2 never drop below prose, and never below the display/title steps.
            expect(sizeOf(css, 'h1')).toBeGreaterThanOrEqual(Math.max(24, editorFontSize))
            expect(sizeOf(css, 'h2')).toBeGreaterThanOrEqual(Math.max(19, editorFontSize))
            expect(sizeOf(css, 'h1')).toBeGreaterThanOrEqual(sizeOf(css, 'h2'))
        })
    }

    test('h5 and h6 change REGISTER rather than just shrinking', () => {
        // The app's own comment: drop the caps + tracking and h5 becomes small body text.
        const css = emit(10, 1.25)
        for (const tag of ['h5', 'h6']) {
            const rule = new RegExp(`\\b${tag} \\{[^}]*\\}`).exec(css)?.[0] ?? ''
            expect(rule).toContain('text-transform: uppercase')
            expect(rule).toMatch(/letter-spacing:\s*[\d.]+em/)
        }
    })

    // The defect this replaced: heading size came from appearance.editorFontSize while the line
    // box came from the export's point size — two settings nothing ties together — so at
    // editorFontSize 28 with a 9pt export an h3 put 28px of glyph in a 5px line box. Sweeping the
    // whole space rather than one sample is the point: the single-point version of this test was
    // green while that 23px overflow shipped.
    test('no heading overflows its line box, across the whole settings space', () => {
        const EDITOR_FONT_SIZES = [11, 13.5, 20, 28] // schema bounds for appearance.editorFontSize
        const LINE_HEIGHTS = [0.8, 1.2, 1.5, 1.8] // schema bounds for editor.lineHeight
        const PT_SIZES = [9, 10, 12, 14, 16, 18] // PDF_FONT_SIZES
        let checked = 0
        for (const efs of EDITOR_FONT_SIZES)
            for (const lh of LINE_HEIGHTS)
                for (const pt of PT_SIZES) {
                    const css = emit(pt, (18 * lh) / (efs * PROSE_SCALE))
                    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
                        const r = new RegExp(`\\b${tag} \\{[^}]*\\}`).exec(css)?.[0] ?? ''
                        const size = Number(/font-size:\s*([\d.]+)px/.exec(r)![1])
                        const box = Number(/line-height:\s*([\d.]+)px/.exec(r)![1])
                        expect(box).toBeGreaterThanOrEqual(size)
                        checked++
                    }
                }
        expect(checked).toBe(576)
    })

    test('tracking stays in em, so it scales with each heading rather than freezing', () => {
        // Resolving an em against a probe element resolves it against the PROBE's font size, not
        // the heading's. That shipped once as letter-spacing: 6px on h5/h6, ~7x the app's real
        // tracking and identical at every font size.
        const css = emit(10, 1.25)
        expect(/h1 \{[^}]*letter-spacing:\s*-?[\d.]+em/.test(css)).toBe(true)
        expect(/h5 \{[^}]*letter-spacing:\s*[\d.]+em/.test(css)).toBe(true)
    })
})

// --- stacked formulas get half a rule of separation --------------------------------------------
// inline-block alone stops a tall formula painting over the line below, but the line box then fits
// its ink EXACTLY, so consecutive formulas touch at 0px. The margins do NOT collapse on an
// inline-block, so a QUARTER rule per side is the half rule of separation between two lines.
describe('inline formulas carry breathing room', () => {
    for (const [label, pt, leading, rule] of [
        ['tight', 10, 21.6 / 17.28, 17],
        ['default', 12, 27 / 17.28, 25],
    ] as const) {
        test(`.katex margin is a quarter rule per side — ${label}`, () => {
            const out = wrapHtmlDocument(
                '<p>x</p>',
                'N',
                { ...DEFAULT_PALETTE.dark, proseLeading: leading },
                '',
                pt,
                false,
                true, // prose: the rendered-note path, which is the only one with a real rule
            )
            const katex = /\.katex \{[^}]*\}/.exec(out)?.[0] ?? ''
            expect(katex).toContain('display: inline-block')
            expect(katex).toContain(`margin-top: ${Math.round(rule / 4)}px`)
            expect(katex).toContain(`margin-bottom: ${Math.round(rule / 4)}px`)
        })
    }
})

// --- everything outside prose returns to the MONO face, and the faces actually ship -----------
describe('mono scoping and embedded faces', () => {
    const emit = () =>
        wrapHtmlDocument(
            '<p>x</p>',
            'N',
            { ...DEFAULT_PALETTE.dark, proseLeading: 1.25 },
            '',
            10,
            false,
            true,
        )

    test('code, frontmatter, tags and task fields take the mono face at the editor size', () => {
        const css = emit()
        // The rule must PARSE, not merely appear: an earlier draft's comment contained a
        // star-slash (the cm-math classes written as one glob), which closed the comment early
        // and made the browser drop this whole rule. The emitted file looked correct and the
        // styling silently did not apply, so this asserts on the rule's own text.
        const rule = /pre, pre code, code,[\s\S]*?\{[^}]*\}/.exec(css)?.[0] ?? ''
        expect(rule).toContain('.fmatter')
        expect(rule).toContain('.bismuth-tag')
        expect(rule).toContain('.bismuth-task-field')
        expect(rule).toMatch(/font-family:\s*'Monaspace Xenon'/)
        // The mono SIZE too: prose is --prose-scale x the editor size and mono does not take that
        // optical compensation, so inheriting the scaled size would render code too large.
        expect(rule).toMatch(/font-size:\s*\d+px/)
    })

    test('no CSS comment closes itself early, which silently drops the rule after it', () => {
        // The generic form of the defect above. A stray star-slash inside a comment terminates it,
        // and everything up to the NEXT one becomes garbage the parser discards — including whole
        // rules. Counting delimiters catches it for every comment in the sheet at once.
        const css = emit()
        const opens = (css.match(/\/\*/g) ?? []).length
        const closes = (css.match(/\*\//g) ?? []).length
        expect(closes).toBe(opens)
    })

    test('tables and headings are deliberately NOT pulled back to mono', () => {
        // The app makes the same exclusions: a table is the note's own content rather than chrome,
        // and headings carry their own absolute scale, so resetting either would flatten it.
        const css = emit()
        const rule = /pre, pre code, code,[\s\S]*?\{[^}]*\}/.exec(css)?.[0] ?? ''
        expect(rule).not.toMatch(/\btable\b/)
        expect(rule).not.toMatch(/\bh[1-6]\b/)
    })
})

// --- no per-document footer -------------------------------------------------------------------
// Every export used to end with a "<name>   1 / 1" footer. On a single continuous document the
// position was always the literal "1 / 1" regardless of how many pages the PDF actually had —
// nine, in the export that prompted its removal — so it was both unwanted and wrong. Removed
// outright rather than made conditional: the repo owner's words were "i hate how it says this at
// the end of every export".
test('an exported document carries no page footer', () => {
    const out = wrapHtmlDocument('<p>x</p>', 'Homework 1')
    expect(out).not.toContain('pagefoot')
    expect(out).not.toContain('1 / 1')
    // The document title still reaches the <title> tag; it is only the visible footer that goes.
    expect(out).toContain('<title>Homework 1</title>')
})
