// app/src/ui/widgetKeys.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { isDismissKey, isConfirmKey } from './widgetKeys'
import { settings, setSettings } from '../settings'

// Faithful synthetic KeyboardEvent — key AND code both set, matching what a real
// browser event carries for these named keys (matchesCombo reads both).
function ev(
    key: 'Escape' | 'Enter' | '.',
    mods: Partial<{ shift: boolean; meta: boolean; code: string }> = {},
): KeyboardEvent {
    return {
        key,
        code: mods.code ?? key,
        metaKey: !!mods.meta,
        ctrlKey: false,
        altKey: false,
        shiftKey: !!mods.shift,
    } as KeyboardEvent
}

// Mod+. as a real browser event actually reports it: key '.', physical code
// "Period", metaKey held.
const modPeriod = () => ev('.', { meta: true, code: 'Period' })

const originalDismiss = settings.keybindings['ui-dismiss']
const originalConfirm = settings.keybindings['ui-confirm']

afterEach(() => {
    setSettings('keybindings', 'ui-dismiss', originalDismiss)
    setSettings('keybindings', 'ui-confirm', originalConfirm)
})

describe('isDismissKey', () => {
    it('Escape dismisses under the default setting', () => {
        setSettings('keybindings', 'ui-dismiss', 'Escape')
        expect(isDismissKey(ev('Escape'))).toBe(true)
    })

    it('Enter is not a dismiss', () => {
        setSettings('keybindings', 'ui-dismiss', 'Escape')
        expect(isDismissKey(ev('Enter'))).toBe(false)
    })

    it('lockout guard: an EMPTY setting still falls back to Escape', () => {
        setSettings('keybindings', 'ui-dismiss', '')
        expect(isDismissKey(ev('Escape'))).toBe(true)
        // the fallback is for an EMPTY setting only — once the setting holds a
        // real combo, that combo governs and Escape is not also accepted
        setSettings('keybindings', 'ui-dismiss', 'Mod+.')
        expect(isDismissKey(modPeriod())).toBe(true)
        expect(isDismissKey(ev('Escape'))).toBe(false)
    })

    it('rebound to something else: Escape no longer dismisses, the new combo does', () => {
        setSettings('keybindings', 'ui-dismiss', 'Mod+.')
        expect(isDismissKey(ev('Escape'))).toBe(false)
        expect(isDismissKey(modPeriod())).toBe(true)
    })
})

describe('isConfirmKey', () => {
    it('Enter confirms under the default setting', () => {
        setSettings('keybindings', 'ui-confirm', 'Enter')
        expect(isConfirmKey(ev('Enter'))).toBe(true)
    })

    it('Shift+Enter is NOT a confirm', () => {
        setSettings('keybindings', 'ui-confirm', 'Enter')
        expect(isConfirmKey(ev('Enter', { shift: true }))).toBe(false)
    })

    it('empty setting means no confirm key at all', () => {
        setSettings('keybindings', 'ui-confirm', '')
        expect(isConfirmKey(ev('Enter'))).toBe(false)
    })
})
