// app/src/keybindings.test.ts
import { describe, it, expect } from 'bun:test'
import {
    parseCombo,
    matchesCombo,
    matchesKeybinding,
    eventToCombo,
    modifierFamily,
    codeToKey,
    toCmKeys,
} from './keybindings'
import { KEYBINDING_CATALOG } from '../../core/src/keybindings'

// Minimal KeyboardEvent stand-in (the matcher reads key/code + the four mods).
function ev(
    key: string,
    mods: Partial<{
        meta: boolean
        ctrl: boolean
        alt: boolean
        shift: boolean
        code: string
    }> = {},
): KeyboardEvent {
    return {
        key,
        code: mods.code,
        metaKey: !!mods.meta,
        ctrlKey: !!mods.ctrl,
        altKey: !!mods.alt,
        shiftKey: !!mods.shift,
    } as KeyboardEvent
}

describe('parseCombo', () => {
    it('parses modifiers and the final key', () => {
        expect(parseCombo('Mod+Shift+D')).toEqual({
            mod: true,
            ctrl: false,
            meta: false,
            alt: false,
            shift: true,
            key: 'd',
        })
        expect(parseCombo('Alt+T')).toEqual({
            mod: false,
            ctrl: false,
            meta: false,
            alt: true,
            shift: false,
            key: 't',
        })
        expect(parseCombo('Mod+`')).toEqual({
            mod: true,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
            key: '`',
        })
    })

    it('sets Ctrl and Meta as their own exact flags, independent of `mod`', () => {
        // Cmd/Command/Meta/Super all set the exact `meta` flag — none of them
        // fold into `mod` any more.
        expect(parseCombo('Cmd+P')).toEqual({
            mod: false,
            ctrl: false,
            meta: true,
            alt: false,
            shift: false,
            key: 'p',
        })
        expect(parseCombo('Command+P')?.meta).toBe(true)
        expect(parseCombo('Meta+P')?.meta).toBe(true)
        expect(parseCombo('Super+P')?.meta).toBe(true)
        // Ctrl/Control set the exact `ctrl` flag.
        expect(parseCombo('Ctrl+P')).toEqual({
            mod: false,
            ctrl: true,
            meta: false,
            alt: false,
            shift: false,
            key: 'p',
        })
        expect(parseCombo('Control+P')?.ctrl).toBe(true)
        // Only literal "Mod" sets `mod`.
        expect(parseCombo('Mod+P')).toEqual({
            mod: true,
            ctrl: false,
            meta: false,
            alt: false,
            shift: false,
            key: 'p',
        })
    })

    it('normalizes key aliases and is whitespace/case tolerant', () => {
        expect(parseCombo('Mod+Alt+Left')?.key).toBe('arrowleft')
        expect(parseCombo('mod + alt + ArrowRight')?.key).toBe('arrowright')
        expect(parseCombo('Plus')?.key).toBe('+')
        expect(parseCombo('Esc')?.key).toBe('escape')
    })

    it('rejects empty / modifier-only combos', () => {
        expect(parseCombo('')).toBeNull()
        expect(parseCombo('   ')).toBeNull()
    })
})

describe('matchesCombo — exact modifier matching', () => {
    it('matches Mod via either meta or ctrl', () => {
        expect(matchesCombo(ev('p', { meta: true }), 'Mod+P')).toBe(true)
        expect(matchesCombo(ev('p', { ctrl: true }), 'Mod+P')).toBe(true)
    })

    it('requires the mod when the combo asks for it', () => {
        expect(matchesCombo(ev('p'), 'Mod+P')).toBe(false)
    })

    it('rejects extra modifiers not in the combo (keeps split-right vs split-down distinct)', () => {
        // Mod+D must NOT fire when Shift is also held…
        expect(matchesCombo(ev('d', { meta: true }), 'Mod+D')).toBe(true)
        expect(
            matchesCombo(ev('d', { meta: true, shift: true }), 'Mod+D'),
        ).toBe(false)
        // …and Mod+Shift+D must NOT fire without Shift.
        expect(
            matchesCombo(ev('d', { meta: true, shift: true }), 'Mod+Shift+D'),
        ).toBe(true)
        expect(matchesCombo(ev('d', { meta: true }), 'Mod+Shift+D')).toBe(false)
    })

    it('rejects mod when the combo has none (Alt+T must not fire under Cmd+Alt+T)', () => {
        expect(matchesCombo(ev('t', { alt: true }), 'Alt+T')).toBe(true)
        expect(matchesCombo(ev('t', { alt: true, meta: true }), 'Alt+T')).toBe(
            false,
        )
    })

    it('is case-insensitive on the key (shift uppercases the event key)', () => {
        expect(
            matchesCombo(ev('D', { meta: true, shift: true }), 'Mod+Shift+D'),
        ).toBe(true)
    })

    it('matches arrow and backtick keys', () => {
        expect(
            matchesCombo(
                ev('ArrowLeft', { meta: true, alt: true }),
                'Mod+Alt+ArrowLeft',
            ),
        ).toBe(true)
        expect(matchesCombo(ev('`', { meta: true }), 'Mod+`')).toBe(true)
    })

    it('matches via physical code when Option composes a character (macOS)', () => {
        // Alt+S on macOS: browser reports key "ß" but code "KeyS".
        expect(
            matchesCombo(ev('ß', { alt: true, code: 'KeyS' }), 'Alt+S'),
        ).toBe(true)
        // Alt+T → "†"; Mod+Alt+= → "≠".
        expect(
            matchesCombo(ev('†', { alt: true, code: 'KeyT' }), 'Alt+T'),
        ).toBe(true)
        expect(
            matchesCombo(
                ev('≠', { meta: true, alt: true, code: 'Equal' }),
                'Mod+Alt+=',
            ),
        ).toBe(true)
    })

    it('still rejects the wrong physical key under Option', () => {
        expect(
            matchesCombo(ev('ß', { alt: true, code: 'KeyS' }), 'Alt+A'),
        ).toBe(false)
    })
})

describe('matchesCombo — Ctrl/Meta exact, independent of Mod', () => {
    // Table-driven over all four (ctrlKey, metaKey) states, per combo.
    it('Ctrl+Space: matches ctrlKey only, never metaKey-only or neither', () => {
        expect(matchesCombo(ev(' ', {}), 'Ctrl+Space')).toBe(false)
        expect(matchesCombo(ev(' ', { ctrl: true }), 'Ctrl+Space')).toBe(true)
        expect(matchesCombo(ev(' ', { meta: true }), 'Ctrl+Space')).toBe(false)
        expect(
            matchesCombo(ev(' ', { ctrl: true, meta: true }), 'Ctrl+Space'),
        ).toBe(false)
    })

    it('Mod+Space: matches ctrlKey, metaKey, or both — never neither', () => {
        expect(matchesCombo(ev(' ', {}), 'Mod+Space')).toBe(false)
        expect(matchesCombo(ev(' ', { ctrl: true }), 'Mod+Space')).toBe(true)
        expect(matchesCombo(ev(' ', { meta: true }), 'Mod+Space')).toBe(true)
        expect(
            matchesCombo(ev(' ', { ctrl: true, meta: true }), 'Mod+Space'),
        ).toBe(true)
    })

    it('Cmd+P (meta) mirrors Ctrl: exact metaKey, independent of mod', () => {
        expect(matchesCombo(ev('p', {}), 'Cmd+P')).toBe(false)
        expect(matchesCombo(ev('p', { meta: true }), 'Cmd+P')).toBe(true)
        expect(matchesCombo(ev('p', { ctrl: true }), 'Cmd+P')).toBe(false)
        expect(
            matchesCombo(ev('p', { meta: true, ctrl: true }), 'Cmd+P'),
        ).toBe(false)
    })

    it('a combo naming none of Mod/Ctrl/Meta requires neither modifier held', () => {
        expect(matchesCombo(ev('t', { alt: true }), 'Alt+T')).toBe(true)
        expect(
            matchesCombo(ev('t', { alt: true, ctrl: true }), 'Alt+T'),
        ).toBe(false)
        expect(
            matchesCombo(ev('t', { alt: true, meta: true }), 'Alt+T'),
        ).toBe(false)
    })
})

describe('codeToKey — physical key resolution', () => {
    it('resolves letters, digits, numpad, and punctuation', () => {
        expect(codeToKey('KeyS')).toBe('s')
        expect(codeToKey('Digit1')).toBe('1')
        expect(codeToKey('Numpad5')).toBe('5')
        expect(codeToKey('Equal')).toBe('=')
        expect(codeToKey('Backquote')).toBe('`')
        expect(codeToKey('Space')).toBe(' ')
    })

    it('returns null for unmapped / named codes (event.key handles those)', () => {
        expect(codeToKey('ArrowLeft')).toBeNull()
        expect(codeToKey('Enter')).toBeNull()
        expect(codeToKey(undefined)).toBeNull()
        expect(codeToKey('')).toBeNull()
    })
})

describe('matchesKeybinding — comma-separated alternatives', () => {
    it('matches any one of the listed combos', () => {
        expect(matchesKeybinding(ev('`', { meta: true }), 'Mod+`, Mod+J')).toBe(
            true,
        )
        expect(matchesKeybinding(ev('j', { meta: true }), 'Mod+`, Mod+J')).toBe(
            true,
        )
        expect(matchesKeybinding(ev('k', { meta: true }), 'Mod+`, Mod+J')).toBe(
            false,
        )
    })

    it('returns false for empty / nullish settings', () => {
        expect(matchesKeybinding(ev('p', { meta: true }), '')).toBe(false)
        expect(matchesKeybinding(ev('p', { meta: true }), undefined)).toBe(
            false,
        )
        expect(matchesKeybinding(ev('p', { meta: true }), null)).toBe(false)
    })
})

describe('modifierFamily', () => {
    // Coarser than parseCombo's own ctrl/meta split (see keybindings.ts):
    // this is what the autocomplete uses to hide an already-picked platform
    // modifier, so Mod/Cmd/Ctrl/Meta/Super still fold into one 'mod' family
    // here even though they set three different exact match flags now.
    it('folds platform modifier tokens into a family, returns null for keys', () => {
        expect(modifierFamily('Mod')).toBe('mod')
        expect(modifierFamily('cmd')).toBe('mod')
        expect(modifierFamily('Ctrl')).toBe('mod')
        expect(modifierFamily('Meta')).toBe('mod')
        expect(modifierFamily('Super')).toBe('mod')
        expect(modifierFamily('Option')).toBe('alt')
        expect(modifierFamily('Shift')).toBe('shift')
        expect(modifierFamily('D')).toBeNull()
        expect(modifierFamily('ArrowLeft')).toBeNull()
    })
})

describe('eventToCombo — recording a shortcut', () => {
    it('builds a combo from modifiers + key, using Mod for meta/ctrl', () => {
        expect(eventToCombo(ev('d', { meta: true, shift: true }))).toBe(
            'Mod+Shift+D',
        )
        expect(eventToCombo(ev('p', { ctrl: true }))).toBe('Mod+P')
        expect(eventToCombo(ev('ArrowLeft', { meta: true, alt: true }))).toBe(
            'Mod+Alt+ArrowLeft',
        )
        expect(eventToCombo(ev(' ', { alt: true }))).toBe('Alt+Space')
        expect(eventToCombo(ev('t', { alt: true }))).toBe('Alt+T')
    })

    it('records the physical key when Option composes a character (macOS)', () => {
        expect(eventToCombo(ev('ß', { alt: true, code: 'KeyS' }))).toBe('Alt+S')
        expect(
            eventToCombo(ev('≠', { meta: true, alt: true, code: 'Equal' })),
        ).toBe('Mod+Alt+=')
    })

    it('returns null for a bare modifier press (keep listening)', () => {
        expect(eventToCombo(ev('Shift', { shift: true }))).toBeNull()
        expect(eventToCombo(ev('Meta', { meta: true }))).toBeNull()
        expect(eventToCombo(ev('Control', { ctrl: true }))).toBeNull()
    })
})

describe('KEYBINDING_CATALOG back-compat', () => {
    // None of the 24 defaults use a literal Ctrl/Cmd/Meta token — only
    // Mod/Alt/Shift — so replaying each one here (iterating the catalog, not
    // hand-listing combos) proves the new exact Ctrl/Meta flags left Mod's
    // portable fold, and the plain Alt/Shift-only combos, matching exactly
    // what they matched before this task.
    const hasToken = (tokens: string[], name: string) =>
        tokens.some(t => t.toLowerCase() === name)

    KEYBINDING_CATALOG.forEach(spec => {
        it(`${spec.id}: "${spec.default}" still matches what it matched before`, () => {
            spec.default.split(',').forEach(rawCombo => {
                const combo = rawCombo.trim()
                const tokens = combo.split('+').map(t => t.trim())
                const key = tokens[tokens.length - 1]
                const mod = hasToken(tokens, 'mod')
                const alt = hasToken(tokens, 'alt')
                const shift = hasToken(tokens, 'shift')

                if (mod) {
                    // Mod still fires under either physical modifier…
                    expect(
                        matchesCombo(ev(key, { meta: true, alt, shift }), combo),
                    ).toBe(true)
                    expect(
                        matchesCombo(ev(key, { ctrl: true, alt, shift }), combo),
                    ).toBe(true)
                    // …and not under neither.
                    expect(matchesCombo(ev(key, { alt, shift }), combo)).toBe(
                        false,
                    )
                } else {
                    // No Mod token: neither Ctrl nor Meta may substitute for it.
                    expect(matchesCombo(ev(key, { alt, shift }), combo)).toBe(
                        true,
                    )
                    expect(
                        matchesCombo(ev(key, { ctrl: true, alt, shift }), combo),
                    ).toBe(false)
                    expect(
                        matchesCombo(ev(key, { meta: true, alt, shift }), combo),
                    ).toBe(false)
                }

                if (alt) {
                    expect(
                        matchesCombo(
                            ev(key, { meta: mod, alt: false, shift }),
                            combo,
                        ),
                    ).toBe(false)
                }
                if (shift) {
                    expect(
                        matchesCombo(
                            ev(key, { meta: mod, alt, shift: false }),
                            combo,
                        ),
                    ).toBe(false)
                }
            })
        })
    })
})

describe('toCmKeys — the CodeMirror key-string converter', () => {
    it('converts a bare key', () => {
        expect(toCmKeys('P')).toEqual(['p'])
        expect(toCmKeys('Escape')).toEqual(['Escape'])
    })

    it('converts Mod', () => {
        expect(toCmKeys('Mod+F')).toEqual(['Mod-f'])
    })

    it('converts Ctrl', () => {
        expect(toCmKeys('Ctrl+Space')).toEqual(['Ctrl-Space'])
    })

    it('converts Shift', () => {
        expect(toCmKeys('Shift+Tab')).toEqual(['Shift-Tab'])
    })

    it('converts Alt', () => {
        expect(toCmKeys('Alt+T')).toEqual(['Alt-t'])
    })

    it('converts multi-modifier combos, preserving written order', () => {
        expect(toCmKeys('Mod+Shift+B')).toEqual(['Mod-Shift-b'])
        expect(toCmKeys('Mod+Alt+ArrowLeft')).toEqual(['Mod-Alt-ArrowLeft'])
    })

    it('converts comma-separated alternatives to one key string each', () => {
        expect(toCmKeys('Mod+`, Mod+J')).toEqual(['Mod-`', 'Mod-j'])
    })

    it('converts named keys — Space becomes the word, not a literal " "', () => {
        expect(toCmKeys('ArrowLeft')).toEqual(['ArrowLeft'])
        expect(toCmKeys('Escape')).toEqual(['Escape'])
        expect(toCmKeys('Mod+Space')).toEqual(['Mod-Space'])
    })

    it('converts punctuation keys', () => {
        expect(toCmKeys('Mod+`')).toEqual(['Mod-`'])
        expect(toCmKeys('Mod+=')).toEqual(['Mod-='])
        expect(toCmKeys('Mod+-')).toEqual(['Mod--'])
    })

    it('returns [] for empty, whitespace, nullish and garbage input', () => {
        expect(toCmKeys('')).toEqual([])
        expect(toCmKeys('   ')).toEqual([])
        expect(toCmKeys(undefined)).toEqual([])
        expect(toCmKeys(null)).toEqual([])
        expect(toCmKeys(' , , ')).toEqual([])
    })

    it('covers every KEYBINDING_CATALOG default without throwing', () => {
        // Regression net: whatever combo core ships as a default must survive
        // the converter — a throw or an empty result here would silently drop
        // a CM-side binding.
        KEYBINDING_CATALOG.forEach(spec => {
            expect(toCmKeys(spec.default).length).toBeGreaterThan(0)
        })
    })
})
