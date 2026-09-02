// app/src/ui/barDropLevels.test.ts
//
// WHY THIS EXISTS. The view bar's collapse ladder is a set of attribute-selector tiers in ui.css
// (`[data-bar-drop='4']` at 650px, '3' at 570, '2' at 500, '1' at 465) and a set of `data-bar-drop`
// attributes on controls. NOTHING connects them. Tag a control with a level the ladder does not
// define and the attribute lands on the DOM, matches no rule, and the control never collapses —
// no typecheck error, no failing test, no warning. The bar simply overflows at a width nobody
// tested. ui.css's own ladder comment states the hole ("nothing typechecks a `data-` attribute");
// this closes it.
//
// It is the same family as bench/moduleClassCheck.ts (a hashed class name that still compiles as a
// literal) and icons/iconCallSites.test.ts (an icon name that still renders, as a placeholder).
// All three are "the string is valid, the referent is missing" bugs, which are invisible to every
// other gate this repo has.
//
// WHAT IT CANNOT SEE, stated so a green run is not over-read: a level built at runtime
// (`data-bar-drop={cond ? '2' : '3'}`) is invisible to a regex — no call site does that today and
// none should, since the level names a MEASURED WIDTH, so choosing one conditionally is already a
// design error. WRITE accepts the realistic literal shapes a formatter or a different author could
// produce (double- or single-quoted, bare or braced), but that is not exhaustive: a shape none of
// those four cover — a space inside the braces, a template literal, an attribute a future formatter
// splits awkwardly across lines — still drops out of `writes` silently while the other real call
// sites keep the total comfortably positive, so the anti-vacuity check below would NOT catch that
// case. Forcing run 3 (see the task report) can only ever demonstrate TOTAL vacuity by construction
// — it zeroes every call site at once — and is not, and cannot be, proof that PARTIAL drift is
// caught.
import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..')
const UI_CSS = join(import.meta.dir, 'ui.css')

/** The JSX attribute. Accepts the realistic shapes a formatter or a different author could write —
 *  double- or single-quoted, bare or braced (`data-bar-drop="2"`, `data-bar-drop='2'`,
 *  `data-bar-drop={"2"}`, `data-bar-drop={'2'}`) — via a backreference so the open/close quote must
 *  match. A genuinely dynamic braced expression (`data-bar-drop={cond ? '2' : '3'}`) has no literal
 *  digit directly against a quote and stays invisible; see the header note above. */
const WRITE = /data-bar-drop=\{?(?<quote>["'])(?<level>\d+)\k<quote>\}?/g
/** The ladder's subjects, which ui.css writes SINGLE-quoted inside attribute selectors. */
const DEFINE = /\[data-bar-drop='(\d+)'\]/g

/** Strip comments before matching, on BOTH sides. Several scanned files DISCUSS the attribute in
 *  prose — ui/BarLabel.stories.tsx, ui/ViewBar.stories.tsx, bases/BaseView.stories.tsx,
 *  ui/ViewBar.tsx and ui/BarLabel.tsx all name a level inside a comment, some of them quoted inside
 *  backticks. Counting a documentation mention as a call site would make this test pass or fail on
 *  the wording of a comment. ui.css gets the same treatment for the same reason: its own ladder
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

test('every data-bar-drop level written in app/src is defined by the ui.css ladder', () => {
    const defined = new Set(
        [...stripComments(readFileSync(UI_CSS, 'utf8')).matchAll(DEFINE)].map(m => m[1]),
    )

    const writes: { file: string; level: string }[] = []
    for (const f of walk(SRC)) {
        for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(WRITE)) {
            writes.push({ file: f.slice(SRC.length + 1), level: m.groups!.level })
        }
    }

    // ANTI-VACUITY, and the more important of the two halves: if the attribute is ever written in a
    // shape this regex misses, `writes` goes empty and the check below passes while testing nothing.
    expect(
        writes.length,
        'found no data-bar-drop call sites at all — the matcher has drifted from how the attribute ' +
            'is written, so this test is passing vacuously',
    ).toBeGreaterThan(0)
    expect(
        defined.size,
        'found no data-bar-drop tiers in ui.css — the ladder moved or was restructured',
    ).toBeGreaterThan(0)

    const orphans = writes.filter(w => !defined.has(w.level))
    expect(
        orphans.map(o => `${o.file}: data-bar-drop="${o.level}"`),
        `ui.css defines levels {${[...defined].sort().join(', ')}}. A level it does not define is a ` +
            `SILENT no-op: the attribute lands on the DOM, no rule matches, the control never drops. ` +
            `Measure your own bar and add a tier, or use the level whose measured width matches.`,
    ).toEqual([])
})
