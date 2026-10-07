import { describe, expect, test } from 'bun:test'
import { DEFAULT_PALETTE } from './exportTheme'
import { THEMES, THEME_NAMES } from '../../../core/src/theme/tokens'
import { SHEET_PAPER, contrastRatio, sheetInkVars } from './sheetInk'

describe('sheetInkVars', () => {
    test('the light sheet ink clears 4.5:1 on the cream sheet, every token it sets', () => {
        const vars = sheetInkVars(DEFAULT_PALETTE.light)
        expect(Object.keys(vars).sort()).toEqual(['--faint', '--fg', '--text-muted'])
        for (const [name, ink] of Object.entries(vars))
            expect(
                contrastRatio(ink, SHEET_PAPER),
                `${name} ${ink} on ${SHEET_PAPER}`,
            ).toBeGreaterThanOrEqual(4.5)
    })

    test('the app ink it replaces does NOT clear it in ink and cathode (the defect this fixes)', () => {
        // Guards the guard: if the app's own ink ever cleared 4.5:1 on cream in every theme, the
        // override would be dead weight and this suite would not notice the test above passing.
        const failing = THEME_NAMES.filter(
            n => contrastRatio(THEMES[n].foreground, SHEET_PAPER) < 4.5,
        )
        expect(failing).toEqual(['ink', 'cathode'])
    })
})
