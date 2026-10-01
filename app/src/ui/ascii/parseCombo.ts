// app/src/ui/ascii/parseCombo.ts
// Turns a stored keybinding combo ("Mod+Shift+D", or a comma-separated sequence
// "Mod+`, Mod+J") into display keys: string[][] — one inner array of key labels
// per comma-separated alternative, plus the rule Kbd types a chord by (spaceBetween).
// Every modifier/key is a lowercase word or one of the design's sanctioned keyboard glyphs
// (⌘ ⌥ ↵ ↑ ↓ — no ⇧/⌫/⇥/←/→); ⌘/⌥ vs ctrl/alt follows isMacPlatform().

import { isMacPlatform } from '../../platform'

const TOKEN: Record<string, (mac: boolean) => string> = {
    Mod: mac => (mac ? '⌘' : 'ctrl'),
    Cmd: () => '⌘',
    Meta: () => '⌘',
    Ctrl: () => 'ctrl',
    Alt: mac => (mac ? '⌥' : 'alt'),
    Option: () => '⌥',
    Shift: () => 'shift',
    Enter: () => '↵',
    Return: () => '↵',
    Backspace: () => 'bksp',
    Delete: () => 'del',
    Escape: () => 'esc',
    Esc: () => 'esc',
    Tab: () => 'tab',
    Space: () => 'space',
    Up: () => '↑',
    Down: () => '↓',
    Left: () => '<',
    Right: () => '>',
    ArrowUp: () => '↑',
    ArrowDown: () => '↓',
    ArrowLeft: () => '<',
    ArrowRight: () => '>',
    Plus: () => '+',
    Command: () => '⌘',
    Super: () => '⌘',
    Opt: () => '⌥',
}

/**
 * Split a stored combo into display caps. Accepts the app's keybinding syntax:
 *   "Mod+Shift+D"        → [["⌘","shift","D"]]        a chord
 *   "Mod+`, Mod+J"       → [["⌘","`"], ["⌘","J"]]     ALTERNATIVES (comma-separated) — either one
 *                                                        fires, not a press-this-then-that sequence
 * `mac` defaults to the running platform; pass it explicitly to render for a
 * specific platform (tests, or a cross-platform hint list).
 */
export function parseCombo(
    combo: string | undefined | null,
    mac: boolean = isMacPlatform(),
): string[][] {
    return String(combo ?? '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part =>
            part.split('+').map(t => {
                const k = t.trim()
                const fn = TOKEN[k]
                if (fn) return fn(mac)
                // An unmapped NAMED key ("PageDown", "F5") joins the lowercase word register; a
                // single character ("K", "`", "3") is typed exactly as bound.
                return k.length > 1 ? k.toLowerCase() : k
            }),
        )
}

/** The sanctioned keyboard glyphs (DESIGN.md) — the only non-ASCII a key label may be. */
const GLYPHS = new Set(['⌘', '⌥', '↵', '↑', '↓'])

/** True for a sanctioned glyph key. Kbd sets these apart: the app font has none of them, so
 *  they fall back to a system face that draws them small and raised (see Kbd.module.css). */
export function isGlyph(key: string): boolean {
    return GLYPHS.has(key)
}

/** Whether two adjacent keys of one chord are typed with a space between them. Single
 *  characters glue (`⌘K`, `⌘⌥K`, `⌘``); a word key is set off by a space each side
 *  (`⌘ shift 3`, `ctrl K`), since `⌘shift3` would read as one token. */
export function spaceBetween(a: string, b: string): boolean {
    return a.length > 1 || b.length > 1
}

