// The mechanical half of the content-heading-ramp gate. HeadingRamp.stories.tsx is the visual half.
//
// WHAT THIS PROTECTS. The app carried FOUR incompatible heading ramps until 2026-08-28, and the
// failure was invisible to every existing check: each ramp was internally consistent, they lived in
// four different files, two were `em` multipliers off an inherited size, and one surface
// (flashcards) set NOTHING and silently inherited the browser's defaults off a 22px base. Nothing
// typechecked wrong. No test failed. The only symptom was that the same markdown looked different
// in every surface, and that h3-h6 rendered SMALLER than the body text they headed.
//
// So this test asserts the two things that would have caught it:
//   1. THE INVARIANT: a heading is never smaller than the prose it heads.
//   2. THE SINGLE SOURCE: every markdown surface reads --fs-h*, and none hardcodes a size or an
//      em multiplier for a heading. Four ramps that happen to agree today is not the same as one
//      ramp — the first is a coincidence with an expiry date.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir)
const read = (p: string) => readFileSync(join(SRC, p), 'utf8')

const tokens = read('styles/tokens.css')

/** Resolve a --fs-* token to px through aliases, max() and min(), for a GIVEN prose size.
 *  `body` is a parameter rather than a constant because --editor-font-size is a USER SETTING
 *  (settingsCssVars.ts projects appearance.editorFontSize), so "does the ramp hold?" is only a
 *  meaningful question when asked across the range a user can actually choose. */
const resolvePx = (name: string, body: number, depth = 0): number => {
    if (depth > 8) throw new Error(`${name}: alias chain too deep`)
    if (name === 'editor-font-size') return body
    const m = tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))
    if (!m) throw new Error(`${name} is not defined in styles/tokens.css`)
    const value = m[1].trim()

    const px = value.match(/^([\d.]+)px$/)
    if (px) return Number(px[1])

    const fn = value.match(/^(max|min)\((.+)\)$/)
    if (fn) {
        const parts = fn[2].split(',').map(a => a.trim())
        const nums = parts.map(a => {
            const v = a.match(/^var\(--([a-z0-9-]+)\)$/)
            if (v) return resolvePx(v[1], body, depth + 1)
            const n = a.match(/^([\d.]+)px$/)
            if (n) return Number(n[1])
            throw new Error(`${name}: cannot resolve argument ${a}`)
        })
        return fn[1] === 'max' ? Math.max(...nums) : Math.min(...nums)
    }

    const alias = value.match(/^var\(--([a-z0-9-]+)\)$/)
    if (alias) return resolvePx(alias[1], body, depth + 1)
    throw new Error(`${name}: cannot resolve ${value} to px`)
}

/** The span a user can actually pick in appearance.editorFontSize, plus the extremes. */
const PROSE_SIZES = [10, 12, 13.5, 15, 18, 22, 28]

test('every heading level is defined and resolves to a real px size', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
        expect(resolvePx(`fs-h${n}`, 13.5)).toBeGreaterThan(0)
        expect(tokens).toContain(`--fw-h${n}:`)
    }
})

test('a heading is never smaller than the prose it heads — AT EVERY USER FONT SIZE', () => {
    // The original bug was h3-h6 rendering smaller than body. The FIRST fix for it was a ramp of
    // fixed pixels, which held only at the default 13.5px setting and reintroduced the bug at any
    // larger one — a fix that looked correct in a story and was wrong in the product. Hence the
    // sweep: the invariant is only worth asserting if it holds everywhere.
    for (const body of PROSE_SIZES) {
        for (const n of [1, 2, 3, 4]) {
            const size = resolvePx(`fs-h${n}`, body)
            expect(
                size,
                `at editorFontSize ${body}px, h${n} resolves to ${size}px — a heading may not be smaller than the text it heads`,
            ).toBeGreaterThanOrEqual(body)
        }
    }
})

test('h5 and h6 never grow ABOVE the prose they head', () => {
    // The mirror of the rule above. h5/h6 are label register; if a user shrinks their prose below
    // 13px a fixed 13px h5 would become LARGER than an h4, inverting the ramp.
    for (const body of PROSE_SIZES) {
        for (const n of [5, 6]) {
            const size = resolvePx(`fs-h${n}`, body)
            expect(
                size,
                `at editorFontSize ${body}px, h${n} resolves to ${size}px, above the ${body}px prose — h5/h6 are label register and must not outgrow the body`,
            ).toBeLessThanOrEqual(body)
        }
    }
})

test('the ramp is monotonic — h1 >= h2 >= h3 >= h4 >= h5 >= h6', () => {
    for (const body of PROSE_SIZES) {
        const sizes = [1, 2, 3, 4, 5, 6].map(n => resolvePx(`fs-h${n}`, body))
        for (let i = 1; i < sizes.length; i++) {
            expect(
                sizes[i],
                `at editorFontSize ${body}px the ramp inverts: h${i} is ${sizes[i - 1]}px but h${i + 1} is ${sizes[i]}px`,
            ).toBeLessThanOrEqual(sizes[i - 1])
        }
    }
})

test('h5 and h6 sit below body size ONLY while they carry the label register', () => {
    // These two are the sanctioned exception: they drop below body size and earn it by changing
    // register (caps + tracking for h5, muted for h6) so they read as labels, not as stunted
    // headings. If a surface drops the case/tracking, the exception is no longer justified.
    const live = read('editor/livePreview.ts')
    const h5 = live.slice(live.indexOf("'.cm-h5'"), live.indexOf("'.cm-h6'"))
    expect(h5).toContain('text-transform')
    expect(h5).toContain('--ls-label')

    const h6 = live.slice(live.indexOf("'.cm-h6'"))
    expect(h6.slice(0, 400)).toContain('text-transform')
})

test('the ramp has ONE definition — no surface hardcodes heading sizes', () => {
    // Each entry is a surface that renders markdown. All five must read the shared tokens.
    const surfaces: Array<[string, string]> = [
        ['BlockEditor.module.css', read('BlockEditor.module.css')],
        ['editor/livePreview.ts', read('editor/livePreview.ts')],
        ['ChatTranscript.module.css', read('ChatTranscript.module.css')],
        ['bases/CardEditModal.module.css', read('bases/CardEditModal.module.css')],
        ['bases/Flashcards.module.css', read('bases/Flashcards.module.css')],
    ]
    for (const [name, src] of surfaces) {
        expect(src, `${name} must read the shared ramp (--fs-h1..h6)`).toMatch(
            /--fs-h[1-6]/,
        )
    }
})

test('no markdown surface sizes a heading with an em multiplier', () => {
    // `em` was how two of the four old ramps expressed themselves, and it is why they could never
    // have agreed: the result depends on whatever font-size the container happened to inherit, so
    // the same markdown rendered at a different size in every surface. The ramp's invariant is
    // unrepresentable in units relative to an inherited size.
    for (const file of [
        'ChatTranscript.module.css',
        'bases/CardEditModal.module.css',
        'bases/Flashcards.module.css',
    ]) {
        const src = read(file)
        for (const line of src.split('\n')) {
            if (!/\bh[1-6]\b/.test(line)) continue
            if (line.trimStart().startsWith('*')) continue // prose in a block comment
            expect(
                line,
                `${file}: heading sized with an em multiplier — use var(--fs-h*)\n  ${line.trim()}`,
            ).not.toMatch(/font-size:\s*[\d.]+em/)
        }
    }
})
