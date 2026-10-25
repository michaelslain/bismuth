// app/src/ui/barDropLevels.test.ts
//
// WHY THIS EXISTS. A trail control opts into the view bar's fit-driven drop with a `data-bar-drop`
// attribute (1-4, 4 drops first; see ui/barFit.ts). ViewBar.tsx stamps `data-bar-hidden` on what does
// not fit and ViewBar.module.css has the one rule that hides it. NOTHING typechecks a `data-`
// attribute: tag a control `data-bar-drop="5"` and it lands on the DOM and never drops, no error and
// no warning. This pins the three strings that have to agree: the levels call sites write, the
// levels barFit.ts defines, and the stylesheet's `[data-bar-hidden]` rule. It also pins that no
// stylesheet rule hides a `data-bar-drop` element by a fixed container width any more, which would
// fight the fit.
//
// It is the same family as bench/moduleClassCheck.ts (a hashed class name that still compiles as a
// literal) and icons/iconCallSites.test.ts: "the string is valid, the referent is missing".
//
// WHAT IT CANNOT SEE: a level built at runtime (`data-bar-drop={cond ? '2' : '3'}`) has no literal
// for the regex below. WRITE accepts the realistic literal shapes (double- or single-quoted, bare or
// braced); a template literal or an awkwardly split attribute drops out of `writes` silently while
// the other call sites keep the total positive, so the anti-vacuity check would not catch it.
import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BAR_DROP_LEVELS } from './barFit'

const SRC = join(import.meta.dir, '..')
const UI_CSS = join(import.meta.dir, 'ViewBar.module.css')

/** The JSX attribute. Accepts the realistic shapes a formatter or a different author could write —
 *  double- or single-quoted, bare or braced (`data-bar-drop="2"`, `data-bar-drop='2'`,
 *  `data-bar-drop={"2"}`, `data-bar-drop={'2'}`) — via a backreference so the open/close quote must
 *  match. A genuinely dynamic braced expression (`data-bar-drop={cond ? '2' : '3'}`) has no literal
 *  digit directly against a quote and stays invisible; see the header note above. */
const WRITE = /data-bar-drop=\{?(?<quote>["'])(?<level>\d+)\k<quote>\}?/g

/** Strip comments before matching, on BOTH sides. Several scanned files DISCUSS the attribute in
 *  prose — ui/BarLabel.stories.tsx, ui/ViewBar.stories.tsx, bases/BaseView.stories.tsx,
 *  ui/ViewBar.tsx and ui/BarLabel.tsx all name a level inside a comment, some of them quoted inside
 *  backticks. Counting a documentation mention as a call site would make this test pass or fail on
 *  the wording of a comment. ViewBar.module.css gets the same treatment for the same reason: its own ladder
 *  comment already discusses levels in quoted form, and while no comment today happens to use the
 *  bracketed `[data-bar-drop='N']` shape DEFINE matches, a future editor documenting a reserved or
 *  rejected level could add one — which would silently inflate `defined` and let a genuinely
 *  orphaned write pass while staying a real no-op in the browser. Stripping both sides makes the
 *  symmetry structural rather than accidental. The `[^:]` guard keeps `https://` out of the
 *  line-comment branch. */
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(e => {
        const p = join(dir, e)
        if (e === 'node_modules' || e === 'dist' || e === 'assets') return []
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) ? [p] : []
    })

test('every data-bar-drop level written in app/src is one barFit.ts defines', () => {
    const defined = new Set(BAR_DROP_LEVELS.map(String))
    const writes: { file: string; level: string }[] = []
    for (const f of walk(SRC)) {
        for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(WRITE)) {
            writes.push({ file: f.slice(SRC.length + 1), level: m.groups!.level })
        }
    }

    // ANTI-VACUITY: if the attribute is ever written in a shape this regex misses, `writes` goes
    // empty and the check below passes while testing nothing.
    expect(
        writes.length,
        'found no data-bar-drop call sites at all — the matcher has drifted from how the attribute ' +
            'is written, so this test is passing vacuously',
    ).toBeGreaterThan(0)

    const orphans = writes.filter(w => !defined.has(w.level))
    expect(
        orphans.map(o => `${o.file}: data-bar-drop="${o.level}"`),
        `barFit.ts defines levels {${[...defined].sort().join(', ')}}. A level it does not define is a ` +
            `SILENT no-op: the attribute lands on the DOM and the control never drops.`,
    ).toEqual([])
})

test('ViewBar.module.css hides [data-bar-hidden] and hides nothing by data-bar-drop', () => {
    const css = stripComments(readFileSync(UI_CSS, 'utf8'))
    expect(css).toMatch(/\.viewbar \[data-bar-hidden\]\s*\{\s*display:\s*none/)
    // A fixed-width tier hiding a `data-bar-drop` element would drop it whether or not it fits.
    expect(css).not.toMatch(/\[data-bar-drop=/)
})

test('ViewBar.tsx stamps data-bar-hidden and reads data-bar-menu-label', () => {
    const tsx = stripComments(readFileSync(join(import.meta.dir, 'ViewBar.tsx'), 'utf8'))
    expect(tsx).toContain('data-bar-hidden')
    expect(tsx).toContain('data-bar-menu-label')
})
