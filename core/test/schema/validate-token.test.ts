// appearance.tokens through the schema validator: one good and one bad value per token kind, the
// exact message, and the unknown-key warning with its did-you-mean.
import { test, expect, describe } from 'bun:test'
import { validateDocument } from '../../src/schema/validate'
import { SETTINGS_SCHEMA } from '../../src/schema/settingsSchema'

const check = (tokens: Record<string, unknown>) =>
    validateDocument({ appearance: { tokens } }, SETTINGS_SCHEMA, {
        mode: 'settings',
    })

const CASES: [kind: string, key: string, good: string, bad: string, message: string][] = [
    ['color', 'bg', '#101010', '@@', 'not a color: @@ (#rrggbb, rgba(0, 0, 0, 0.5), or transparent)'],
    ['scheme', 'color-scheme', 'light', '@@', 'not a color scheme: @@ (light or dark)'],
    ['gradient', 'grad', 'linear-gradient(120deg, #c98ca8, #8296c6)', '@@', 'not a gradient: @@ (linear-gradient(120deg, #c98ca8, #8296c6))'],
    ['shadow', 'state-focus-ring', 'none', '@@', 'not a shadow: @@ (none, or 2px 2px 0 rgba(0, 0, 0, 0.4))'],
    ['number', 'state-disabled-op', '0.5', '@@', 'not a number: @@ (1.5)'],
    ['border', 'focus-ring', '1px solid #3a3e4a', '@@', 'not a border: @@ (1px solid #3a3e4a)'],
    ['length', 'sp-3', '10px', '@@', 'not a length: @@ (6px, 0.5em, or a number of px)'],
    ['font-mono', 'ui-font-stack', 'Monaspace Neon', '@@', 'not a mono font: @@ (Monaspace Xenon, Monaspace Neon, Monaspace Argon, Monaspace Krypton, Monaspace Radon)'],
    ['font-prose', 'prose-font', 'Lora', '@@', 'not a prose font: @@ (Libron, IBM Plex Serif, Lora, Monaspace Xenon, Monaspace Neon, Monaspace Argon, Monaspace Krypton, Monaspace Radon)'],
    ['duration', 'dur-fast', '120ms', '@@', 'not a duration: @@ (120ms, 0.2s, or a number of ms)'],
    ['easing', 'ease', 'linear', '@@', 'not an easing: @@ (ease, linear, or cubic-bezier(0.2, 0, 0, 1))'],
]

describe('appearance.tokens validation', () => {
    for (const [kind, key, good, bad, message] of CASES) {
        test(`${kind}: ${key} accepts ${good}`, () => {
            expect(check({ [key]: good })).toEqual([])
        })
        test(`${kind}: ${key} rejects ${bad} with the registry message`, () => {
            const d = check({ [key]: bad })
            expect(d).toHaveLength(1)
            expect(d[0].severity).toBe('error')
            expect(d[0].path).toEqual(['appearance', 'tokens', key])
            expect(d[0].message).toBe(message)
        })
    }

    test('a bare number is a valid length', () => {
        expect(check({ 'sp-3': 10 })).toEqual([])
    })

    test('an unknown token warns with a did-you-mean', () => {
        const d = check({ 'sp-33': '10px' })
        expect(d).toHaveLength(1)
        expect(d[0].severity).toBe('warning')
        expect(d[0].path).toEqual(['appearance', 'tokens', 'sp-33'])
        expect(d[0].message).toBe('unknown token: sp-33')
        expect(d[0].suggestions?.length).toBe(1)
    })
})

describe('appearance.tokens reports every problem', () => {
    test('two bad tokens + a bad uiFont give three diagnostics', () => {
        const d = validateDocument(
            {
                appearance: {
                    tokens: { 'sp-3': '@@', 'sp-4': '@@' },
                    uiFont: 'Comic',
                },
            },
            SETTINGS_SCHEMA,
            { mode: 'settings' },
        )
        expect(d.length).toBe(3)
    })
    test('an inherited-name key is an unknown token', () => {
        const d = check({ constructor: 1 })
        expect(d.length).toBe(1)
        expect(d[0].severity).toBe('warning')
        expect(d[0].message).toBe('unknown token: constructor')
    })
})
