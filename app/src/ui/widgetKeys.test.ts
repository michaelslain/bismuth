// app/src/ui/widgetKeys.test.ts
import { describe, it, expect, afterEach } from 'bun:test'
import { isDismissKey, isConfirmKey } from './widgetKeys'
import { settings, setSettings } from '../settings'

// Faithful synthetic KeyboardEvent — key AND code both set, matching what a real
// browser event carries for these named keys (matchesCombo reads both).
function ev(
    key: 'Escape' | 'Enter',
    mods: Partial<{ shift: boolean }> = {},
): KeyboardEvent {
    return {
        key,
        code: key,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: !!mods.shift,
    } as KeyboardEvent
}

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
    })

    it('rebound to something else: Escape no longer dismisses', () => {
        setSettings('keybindings', 'ui-dismiss', 'Mod+.')
        expect(isDismissKey(ev('Escape'))).toBe(false)
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
