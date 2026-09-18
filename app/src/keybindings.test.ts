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

    it('an explicit Ctrl token stays exact even alongside Mod', () => {
        expect(matchesCombo(ev('k', { ctrl: true }), 'Mod+Ctrl+K')).toBe(true)
        expect(
            matchesCombo(ev('k', { ctrl: true, meta: true }), 'Mod+Ctrl+K'),
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

describe('KEYBINDING_CATALOG defaults — modifier truth table', () => {
    // The catalog now has 49 entries, and unlike the original 24 it uses literal
    // Ctrl/Cmd/Meta tokens (open-completion: "Ctrl+Space, Mod+Shift+Space") and
    // shifted-punctuation alternatives (graph-zoom-in: "=, Shift+=, Plus") on top
    // of the plain Mod/Alt/Shift combos. A synthetic KeyboardEvent built from a
    // combo's literal token is NOT what a browser actually sends — a real space
    // keypress is `key: ' ', code: 'Space'`, not `key: 'Space'` — so this block
    // builds each event the way `parseCombo`/`codeToKey` (the same primitives the
    // matcher itself uses) say a real one would look, then walks the full
    // Mod / exact-Ctrl / exact-Meta / none truth table plus Alt/Shift requiredness.
    // Still iterates the catalog — never hand-lists ids — so a new default gets
    // this coverage for free.
    //
    // This does NOT compare against the pre-catalog hardcoded predicates —
    // a default that narrows or widens one (e.g. dropping a modifier-agnostic Cmd+Backspace) passes
    // here. Behaviour preservation is a review question, not something this block measures.

    // Reverse of `codeToKey`: probe every code it knows how to resolve and record
    // the first one that resolves to each normalized key, so the physical `code`
    // half of a synthetic event is derived from the real mapping instead of a
    // hand-copied guess that can drift from it.
    const CODE_CANDIDATES = [
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => `Key${c}`),
        ...'0123456789'.split('').map(d => `Digit${d}`),
        'Minus',
        'Equal',
        'BracketLeft',
        'BracketRight',
        'Backslash',
        'Semicolon',
        'Quote',
        'Backquote',
        'Comma',
        'Period',
        'Slash',
        'Space',
        'NumpadAdd',
        'NumpadSubtract',
        'NumpadMultiply',
        'NumpadDivide',
        'NumpadDecimal',
        ...'0123456789'.split('').map(d => `Numpad${d}`),
    ]
    const keyToCode: Record<string, string> = {}
    CODE_CANDIDATES.forEach(code => {
        const key = codeToKey(code)
        if (key !== null && !(key in keyToCode)) keyToCode[key] = code
    })

    // The handful of punctuation/digit keys whose Shift-held `event.key` is a
    // DIFFERENT character than the bare key (Shift+Equal reports "+", not "="):
    // real, confirmed values — there's no exported table to derive them from.
    // Anything shift-sensitive that shows up without an entry here throws below
    // rather than silently building an event that only matches by accident.
    const SHIFT_SHIFTS: Record<string, string> = {
        '=': '+',
        '-': '_',
    }
    const SHIFT_SENSITIVE = new Set([
        '`',
        '-',
        '=',
        '[',
        ']',
        '\\',
        ';',
        "'",
        ',',
        '.',
        '/',
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
    ])

    KEYBINDING_CATALOG.forEach(spec => {
        it(`${spec.id}: "${spec.default}" obeys the Mod/Ctrl/Meta/Alt/Shift truth table`, () => {
            spec.default.split(',').forEach(rawCombo => {
                const combo = rawCombo.trim()
                const parsed = parseCombo(combo)
                if (!parsed)
                    throw new Error(`catalog default "${combo}" failed to parse`)
                const { mod, ctrl, meta, alt, shift, key } = parsed

                let eventKey = key
                if (shift && SHIFT_SENSITIVE.has(key)) {
                    const shifted = SHIFT_SHIFTS[key]
                    if (shifted === undefined)
                        throw new Error(
                            `"${combo}": no known Shift-modified character for key "${key}" — add it to SHIFT_SHIFTS instead of building an unfaithful event`,
                        )
                    eventKey = shifted
                }
                const code = keyToCode[key]

                const build = (
                    over: {
                        ctrl?: boolean
                        meta?: boolean
                        alt?: boolean
                        shift?: boolean
                    } = {},
                ) => ev(eventKey, { alt, shift, code, ...over })

                if (mod) {
                    // Mod fires under metaKey alone, ctrlKey alone, or both…
                    expect(
                        matchesCombo(build({ meta: true, ctrl: false }), combo),
                    ).toBe(true)
                    expect(
                        matchesCombo(build({ ctrl: true, meta: false }), combo),
                    ).toBe(true)
                    expect(
                        matchesCombo(build({ ctrl: true, meta: true }), combo),
                    ).toBe(true)
                    // …and not under neither.
                    expect(
                        matchesCombo(build({ ctrl: false, meta: false }), combo),
                    ).toBe(false)
                } else if (ctrl) {
                    // Exact Ctrl: ctrlKey alone only — not metaKey-only, not both,
                    // not bare.
                    expect(
                        matchesCombo(build({ ctrl: true, meta: false }), combo),
                    ).toBe(true)
                    expect(
                        matchesCombo(build({ ctrl: false, meta: true }), combo),
                    ).toBe(false)
                    expect(
                        matchesCombo(build({ ctrl: true, meta: true }), combo),
                    ).toBe(false)
                    expect(
                        matchesCombo(build({ ctrl: false, meta: false }), combo),
                    ).toBe(false)
                } else if (meta) {
                    // Exact Cmd/Meta: mirrors Ctrl.
                    expect(
                        matchesCombo(build({ meta: true, ctrl: false }), combo),
                    ).toBe(true)
                    expect(
                        matchesCombo(build({ meta: false, ctrl: true }), combo),
                    ).toBe(false)
                    expect(
                        matchesCombo(build({ meta: true, ctrl: true }), combo),
                    ).toBe(false)
                    expect(
                        matchesCombo(build({ meta: false, ctrl: false }), combo),
                    ).toBe(false)
                } else {
                    // No Mod/Ctrl/Meta token: neither may substitute for it.
                    expect(
                        matchesCombo(build({ ctrl: false, meta: false }), combo),
                    ).toBe(true)
                    expect(
                        matchesCombo(build({ ctrl: true, meta: false }), combo),
                    ).toBe(false)
                    expect(
                        matchesCombo(build({ ctrl: false, meta: true }), combo),
                    ).toBe(false)
                }

                // Whichever modifier satisfied the branch above, dropping Alt or
                // Shift when the combo asks for either must still reject.
                const satisfyCtrl = ctrl
                const satisfyMeta = meta || mod
                if (alt) {
                    expect(
                        matchesCombo(
                            build({ ctrl: satisfyCtrl, meta: satisfyMeta, alt: false }),
                            combo,
                        ),
                    ).toBe(false)
                }
                if (shift) {
                    expect(
                        matchesCombo(
                            build({
                                ctrl: satisfyCtrl,
                                meta: satisfyMeta,
                                shift: false,
                            }),
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
