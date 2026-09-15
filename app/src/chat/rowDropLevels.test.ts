// app/src/chat/rowDropLevels.test.ts
//
// WHY THIS EXISTS. `data-row-drop` is the quiet controls row's OWN collapse ladder (ChatControls.tsx
// tags a control, ChatControls.module.css's `@container chatcontrolsrow` rules hide it past a
// threshold) — the `data-row-drop` sibling of ui/ui.css's `data-bar-drop` ladder, which
// ui/barDropLevels.test.ts already guards. NOTHING connects a tag to a tier any more here than it
// does there: tag a control with a level the CSS does not define and the attribute lands on the DOM,
// matches no `@container` rule, and the control never drops — no typecheck error, no failing test,
// no warning. The row simply overflows at a width nobody tested (final-findings Group 2 #4).
//
// This is the SAME check as barDropLevels.test.ts, re-pointed at a different attribute and a
// different source file — see that file's header comment for the fuller rationale (the "string is
// valid, the referent is missing" family: bench/moduleClassCheck.ts, icons/iconCallSites.test.ts).
// WHAT IT CANNOT SEE is identical too: a level built at runtime (`data-row-drop={cond ? '2' : '3'}`)
// is invisible to a regex — no call site does that today (every level in ChatControls.tsx is a
// literal string prop on `RowAction`/a literal JSX attribute) and none should, since the level names
// a MEASURED WIDTH. WRITE accepts double- or single-quoted, bare or braced shapes; a shape none of
// those cover still drops out of `writes` silently, which is why the anti-vacuity check below exists
// — it can only prove TOTAL vacuity by construction, not rule out PARTIAL drift.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = import.meta.dir
const CSS = join(DIR, 'ChatControls.module.css')
const TSX = join(DIR, 'ChatControls.tsx')

/** The JSX attribute/prop. `data-row-drop` is written directly in ChatControls.tsx (the Select
 *  `bar-item` spans) and passed through as `rowDrop` on `RowAction`, which forwards it to
 *  `data-row-drop` on the underlying `<Button>` — so the SOURCE of truth for "what level is this
 *  control" is always a literal string at one of these two spellings: the bare JSX attribute
 *  (`data-row-drop="2"`) or the prop RowAction is called with (`rowDrop="3"`). Accepts double- or
 *  single-quoted, bare or braced, via a backreference so the open/close quote must match. */
const WRITE = /(?:data-row-drop|rowDrop)=\{?(?<quote>["'])(?<level>\d+)\k<quote>\}?/g
/** The ladder's subjects, which ChatControls.module.css writes SINGLE-quoted inside `@container`
 *  attribute selectors, same shape as ui.css's `data-bar-drop` ladder. */
const DEFINE = /\[data-row-drop='(\d+)'\]/g

/** Strip comments before matching, on BOTH sides — this file's own comments (and ChatControls.tsx's
 *  ladder-priority comments) discuss levels in prose, and a documentation mention must not count as
 *  either a write or a definition. */
const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

test('every data-row-drop level written in ChatControls.tsx is defined by ChatControls.module.css', () => {
    const defined = new Set(
        [...stripComments(readFileSync(CSS, 'utf8')).matchAll(DEFINE)].map(
            m => m[1],
        ),
    )

    const writes = [
        ...stripComments(readFileSync(TSX, 'utf8')).matchAll(WRITE),
    ].map(m => m.groups!.level)

    // ANTI-VACUITY, the more important of the two halves: if the attribute/prop is ever written in
    // a shape this regex misses, `writes` goes empty and the check below passes while testing
    // nothing.
    expect(
        writes.length,
        'found no data-row-drop / rowDrop call sites at all in ChatControls.tsx — the matcher has ' +
            'drifted from how the level is written, so this test is passing vacuously',
    ).toBeGreaterThan(0)
    expect(
        defined.size,
        'found no data-row-drop tiers in ChatControls.module.css — the ladder moved or was ' +
            'restructured',
    ).toBeGreaterThan(0)

    const orphans = writes.filter(level => !defined.has(level))
    expect(
        orphans.map(level => `ChatControls.tsx: data-row-drop="${level}"`),
        `ChatControls.module.css defines levels {${[...defined].sort().join(', ')}}. A level it ` +
            `does not define is a SILENT no-op: the attribute lands on the DOM, no @container rule ` +
            `matches, the control never drops. Measure the row at the width in question and add a ` +
            `tier, or use the level whose measured width matches.`,
    ).toEqual([])
})
