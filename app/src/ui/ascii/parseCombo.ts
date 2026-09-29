// app/src/ui/ascii/parseCombo.ts
// Turns a stored keybinding combo ("Mod+Shift+D", or a comma-separated sequence
// "Mod+`, Mod+J") into display caps: string[][] — one inner array of cap labels
// per comma-separated alternative.
// Every modifier/key is plain text or one of the design's sanctioned keyboard caps (⌘ ⌥ ↵ ↑ ↓ — no
// ⇧/⌫/⇥/←/→); ⌘/⌥ vs Ctrl/Alt follows isMacPlatform().

import { isMacPlatform } from '../../platform'

const TOKEN: Record<string, (mac: boolean) => string> = {
    Mod: mac => (mac ? '⌘' : 'Ctrl'),
    Cmd: () => '⌘',
    Meta: () => '⌘',
    Ctrl: () => 'Ctrl',
    Alt: mac => (mac ? '⌥' : 'Alt'),
    Option: () => '⌥',
    Shift: () => 'Shift',
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
 *   "Mod+Shift+D"        → [["⌘","Shift","D"]]        a chord
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
                return fn ? fn(mac) : k
            }),
        )
}
