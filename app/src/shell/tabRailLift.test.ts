// Guards TabRail.module.css's cascade: the flyout lift (`box-shadow: var(--rail-lift)`) belongs to
// the UNPINNED rail only. The hover rule that paints it is (0,4,0), so a later plain
// `.rail-pinned { box-shadow: none }` ((0,3,0)) would LOSE to it and a pinned rail under the pointer
// would grow its lift back — no typecheck, story or computed-style baseline sees that, because
// `:hover` cannot be posed from a play. The only structural fix is that every selector which paints
// the lift is itself conditioned on `:not(.rail-pinned)`, so this pins exactly that.
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(import.meta.dir, 'TabRail.module.css'), 'utf8')

/** Every `selectors { body }` block with comments removed (the file has no nested at-rule rules
 *  that paint the lift; `@media` wrappers would still be matched by their inner blocks). */
function rulesPainting(source: string, value: string): string[][] {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
    const out: string[][] = []
    for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const declares = new RegExp(`box-shadow\\s*:\\s*${value}\\s*[;}]?`).test(
            m[2] + ';',
        )
        if (declares)
            out.push(
                m[1]
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean),
            )
    }
    return out
}

describe('TabRail.module.css lift', () => {
    const rules = rulesPainting(css, 'var\\(--rail-lift\\)')

    it('finds the rule that paints the lift (not vacuous)', () => {
        expect(rules.length).toBeGreaterThan(0)
    })

    it('every selector that paints --rail-lift excludes a pinned rail', () => {
        for (const selectors of rules)
            for (const sel of selectors)
                expect(sel).toContain(':not(.rail-pinned)')
    })

    it('the guard itself can fail: a plain hover rule is flagged', () => {
        const bad = rulesPainting(
            '.tab-rail:hover .tab-rail-inner { box-shadow: var(--rail-lift); }',
            'var\\(--rail-lift\\)',
        )
        expect(bad.length).toBe(1)
        expect(bad[0][0]).not.toContain(':not(.rail-pinned)')
    })
})
