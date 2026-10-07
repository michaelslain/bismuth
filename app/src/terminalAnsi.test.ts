import { describe, expect, it } from 'bun:test'
import { THEMES, THEME_NAMES } from '../../core/src/theme/tokens'
import {
    MIN_ANSI_CONTRAST,
    contrastRatio,
    ensureContrast,
    parseColor,
} from './terminalAnsi'

const rgb = (c: string) => parseColor(c)!

describe('parseColor', () => {
    it('reads hex, short hex and rgb()', () => {
        expect(parseColor('#101116')).toEqual([16, 17, 22])
        expect(parseColor('#fff')).toEqual([255, 255, 255])
        expect(parseColor('rgb(16, 17, 22)')).toEqual([16, 17, 22])
        expect(parseColor('rgba(16, 17, 22, 0.5)')).toEqual([16, 17, 22])
    })
    it('returns null for what it cannot read', () => {
        expect(parseColor('transparent')).toBeNull()
        expect(parseColor('var(--rail)')).toBeNull()
        expect(parseColor('')).toBeNull()
    })
})

describe('contrastRatio', () => {
    it('matches the WCAG endpoints', () => {
        expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5)
        expect(contrastRatio([9, 9, 9], [9, 9, 9])).toBe(1)
    })
})

describe('ensureContrast', () => {
    it('leaves a colour that already clears the floor untouched', () => {
        expect(ensureContrast('#ffffff', '#c9c4b6', '#101116')).toBe('#ffffff')
    })
    it('returns the input when a colour is unreadable', () => {
        expect(ensureContrast('var(--x)', '#fff', '#000')).toBe('var(--x)')
    })
    it('lifts ink-on-ink black to the floor', () => {
        const out = ensureContrast('#101116', '#C9C4B6', '#101116')
        expect(contrastRatio(rgb(out), rgb('#101116'))).toBeGreaterThanOrEqual(
            MIN_ANSI_CONTRAST,
        )
    })
})

// The proof for the invisible-black finding: ANSI black against the terminal's own ground in every
// built-in theme, before (the raw --rail token, which is what Terminal.tsx used to hand xterm) and
// after (what buildTerminalTheme hands it now). Printed so the numbers land in the report.
describe('ANSI black in every theme', () => {
    const rows = THEME_NAMES.map(name => {
        const t = THEMES[name]
        const bg = t.termBg ?? '#08090E'
        const fg = t.termFg ?? '#C7CCE0'
        const before = t.rail!
        const after = ensureContrast(before, fg, bg)
        return {
            name,
            bg,
            before,
            after,
            beforeRatio: contrastRatio(rgb(before), rgb(bg)),
            afterRatio: contrastRatio(rgb(after), rgb(bg)),
            fgRatio: contrastRatio(rgb(fg), rgb(bg)),
        }
    })
    it('prints the before/after table', () => {
        console.log(
            rows
                .map(
                    r =>
                        `${r.name.padEnd(8)} bg ${r.bg} black ${r.before} -> ${r.after}  ${r.beforeRatio.toFixed(2)}:1 -> ${r.afterRatio.toFixed(2)}:1  (term-fg ${r.fgRatio.toFixed(2)}:1)`,
                )
                .join('\n'),
        )
    })
    it('the raw token is invisible in the themes the finding names', () => {
        const byName = Object.fromEntries(rows.map(r => [r.name, r]))
        expect(byName.ink.beforeRatio).toBeLessThan(1.1)
        expect(byName.cathode.beforeRatio).toBeLessThan(1.1)
    })
    for (const name of THEME_NAMES) {
        it(`${name}: black reads at ${MIN_ANSI_CONTRAST}:1 or better`, () => {
            const r = rows.find(x => x.name === name)!
            expect(r.afterRatio).toBeGreaterThanOrEqual(MIN_ANSI_CONTRAST)
        })
    }
})
