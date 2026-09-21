// Guards the cascade that made the one-global-stylesheet merge (Task 14) safe: global.css is
// ONE file now, but it is still textually the twelve former files back to back, each its own
// commented section (see cssLayering.test.ts's header for the full list + why textual order
// matters — the old `@import` hoisting is now just position in this one file).
//
// A class selector or a `:root` custom property declared in TWO sections is a duplicate the old
// multi-file layout could never produce (each file only ever saw its own rules) and the merge
// could: whichever section comes LATER in the file silently wins the cascade, with nothing in a
// typecheck, a unit test or a console warning to say so. This suite parses global.css into its
// sections by the same banner comments cssLayering.test.ts already relies on, and fails if any
// class selector or :root custom property is defined in more than one section.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = import.meta.dir
const globalCss = readFileSync(join(SRC, 'global.css'), 'utf8')

/** Strip CSS comments first, so a class name only ever MENTIONED in prose (as cssLayering.test.ts
 *  notes several sections do) is never mistaken for a declaration. */
const stripComments = (css: string): string =>
    css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Strip `:global(...)` regions (parens-matched, mirroring cssLayering.test.ts's stripGlobal) —
 *  a name inside `:global(...)` is not hashed and is not "this section's own class" in the sense
 *  this guard cares about. */
function stripGlobal(css: string): string {
    let out = ''
    let i = 0
    for (;;) {
        const at = css.indexOf(':global(', i)
        if (at < 0) return out + css.slice(i)
        out += css.slice(i, at)
        let depth = 0
        let j = at + ':global'.length
        for (; j < css.length; j++) {
            if (css[j] === '(') depth++
            else if (css[j] === ')' && --depth === 0) break
        }
        i = j + 1
    }
}

interface Section {
    title: string
    start: number
    end: number
    body: string
}

/** Banner shape (verified against every section in global.css):
 *      /* ====...====
 *       * <title>
 *       * ====...====
 *       * /
 *  `title` is the bit before " (" / end of line, e.g. "styles/tokens.css — design tokens". */
const BANNER = /\/\* =+\n \* (.+?)\n \* =+ ?\*?\/?\n/g

function parseSections(css: string): Section[] {
    const markers: { title: string; start: number }[] = []
    for (const m of css.matchAll(BANNER)) {
        markers.push({ title: m[1], start: m.index! })
    }
    if (markers.length === 0) throw new Error('no section banners found in global.css')
    return markers.map((m, i) => {
        const end = i + 1 < markers.length ? markers[i + 1].start : css.length
        return { title: m.title, start: m.start, end, body: css.slice(m.start, end) }
    })
}

const sections = parseSections(globalCss)

/** Full selectors (not individual class tokens) DECLARED in `css` that mention at least one class
 *  — i.e. each comma-separated compound selector immediately before a `{`, whitespace-normalized.
 *  This is deliberately selector-level, not token-level: `.layout` and `.layout.switcher-active`
 *  are two DIFFERENT selectors (one is a compound of the other), and treating them as "the same
 *  class .layout, declared twice" would make every state/variant selector in the codebase a false
 *  positive — App.css's own `.layout`/`.layout.has-rail`/`.layout.has-rail.switcher-active` family
 *  is exactly this shape. A real duplicate is the SAME selector, verbatim, in two sections. */
function selectorsDeclaredIn(css: string): Set<string> {
    const scanned = stripGlobal(stripComments(css))
    const out = new Set<string>()
    // Selector lists end right before their `{`. This deliberately ignores @-rules' preludes
    // (@media, @keyframes, @property, @font-face, ...), which never declare a selector themselves.
    const selectorBlocks = scanned.match(/[^{}]+\{/g) ?? []
    for (const block of selectorBlocks) {
        const selectorText = block.slice(0, -1)
        if (/@/.test(selectorText.trim().slice(0, 1))) continue
        for (const raw of selectorText.split(',')) {
            const sel = raw.replace(/\s+/g, ' ').trim()
            if (sel && sel.includes('.')) out.add(sel)
        }
    }
    return out
}

/** Custom properties defined inside any `:root { ... }` block in `css`. */
function rootCustomPropsDeclaredIn(css: string): Set<string> {
    const scanned = stripGlobal(stripComments(css))
    const out = new Set<string>()
    const re = /:root\s*\{/g
    let m: RegExpExecArray | null
    while ((m = re.exec(scanned))) {
        // Match braces to find this :root block's extent.
        let depth = 1
        let j = m.index + m[0].length
        for (; j < scanned.length && depth > 0; j++) {
            if (scanned[j] === '{') depth++
            else if (scanned[j] === '}') depth--
        }
        const body = scanned.slice(m.index + m[0].length, j - 1)
        for (const prop of body.match(/--[a-zA-Z0-9_-]+(?=\s*:)/g) ?? [])
            out.add(prop)
    }
    return out
}

/** Selectors that are legitimately declared twice because they are a stateful VARIANT of the same
 *  rule split across two sections on purpose, not an accidental duplicate. Each entry names the
 *  exact selector, the two sections, and why — so a new accidental duplicate is still caught. */
const ALLOWED_DUPLICATE_CLASSES: ReadonlySet<string> = new Set([])
const ALLOWED_DUPLICATE_ROOT_PROPS: ReadonlySet<string> = new Set([])

describe('global.css sections do not collide', () => {
    it('parses global.css into the twelve former-file sections', () => {
        // Without this the suite passes vacuously the day a banner is reworded or removed.
        expect(sections.length).toBeGreaterThanOrEqual(12)
        expect(sections.map(s => s.title)).toContain(
            'styles/tokens.css — design tokens (hoisted first: former @import in App.css)',
        )
    })

    it('no class selector is declared in two different sections', () => {
        const bySection = sections.map(s => ({
            title: s.title,
            classes: selectorsDeclaredIn(s.body),
        }))
        const offenders: string[] = []
        for (let i = 0; i < bySection.length; i++) {
            for (let j = i + 1; j < bySection.length; j++) {
                for (const cls of bySection[i].classes) {
                    if (ALLOWED_DUPLICATE_CLASSES.has(cls)) continue
                    if (bySection[j].classes.has(cls)) {
                        offenders.push(
                            `${cls}: "${bySection[i].title}" + "${bySection[j].title}"`,
                        )
                    }
                }
            }
        }
        expect(offenders).toEqual([])
    })

    it('no custom property is defined in :root in two different sections', () => {
        const bySection = sections.map(s => ({
            title: s.title,
            props: rootCustomPropsDeclaredIn(s.body),
        }))
        const offenders: string[] = []
        for (let i = 0; i < bySection.length; i++) {
            for (let j = i + 1; j < bySection.length; j++) {
                for (const prop of bySection[i].props) {
                    if (ALLOWED_DUPLICATE_ROOT_PROPS.has(prop)) continue
                    if (bySection[j].props.has(prop)) {
                        offenders.push(
                            `${prop}: "${bySection[i].title}" + "${bySection[j].title}"`,
                        )
                    }
                }
            }
        }
        expect(offenders).toEqual([])
    })

    it('the scanner catches a duplicate class planted across two sections', () => {
        // Prove the guard can fail, against text shaped like real sections, not just the live file.
        const a = '/* ==\n * a.css — one\n * ==\n */\n.shared-thing { color: red; }\n'
        const b = '/* ==\n * b.css — two\n * ==\n */\n.shared-thing { color: blue; }\n'
        const parsed = parseSections(a + b)
        expect(parsed.length).toBe(2)
        const classesA = selectorsDeclaredIn(parsed[0].body)
        const classesB = selectorsDeclaredIn(parsed[1].body)
        expect([...classesA].some(c => classesB.has(c))).toBe(true)
        // And a non-overlapping pair reports clean.
        const c = '/* ==\n * c.css — three\n * ==\n */\n.only-c { color: green; }\n'
        const parsedClean = parseSections(a + c)
        const classesC = selectorsDeclaredIn(parsedClean[1].body)
        expect([...classesA].some(cls => classesC.has(cls))).toBe(false)
    })

    it('the scanner catches a duplicate :root custom property planted across two sections', () => {
        const a = '/* ==\n * a.css — one\n * ==\n */\n:root { --shared-token: 1px; }\n'
        const b = '/* ==\n * b.css — two\n * ==\n */\n:root { --shared-token: 2px; }\n'
        const parsed = parseSections(a + b)
        const propsA = rootCustomPropsDeclaredIn(parsed[0].body)
        const propsB = rootCustomPropsDeclaredIn(parsed[1].body)
        expect([...propsA].some(p => propsB.has(p))).toBe(true)
    })
})
