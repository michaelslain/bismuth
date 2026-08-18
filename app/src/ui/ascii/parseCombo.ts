// app/src/ui/ascii/parseCombo.ts
// Turns a stored keybinding combo ("Mod+Shift+D", or a comma-separated sequence
// "Mod+`, Mod+J") into display caps: string[][] — one inner array of cap labels
// per comma-separated alternative.
//
// The Mod/Cmd/Meta/Ctrl/Alt/Shift → glyph mapping mirrors
// app/src/palette/CommandPalette.tsx's inline `formatShortcut()` (same IS_MAC
// check, same glyphs). That copy only handles the first alternative and doesn't
// need Enter/Escape/arrow caps, so it wasn't reusable as-is; this is the
// extracted, fuller version — CommandPalette should adopt this helper instead
// of its own inline copy next time it's touched.

/** True on macOS/iPadOS/iOS — decides ⌘/⌥ glyphs vs Ctrl/Alt text. Every other modifier/key
 *  is plain text or one of the design's sanctioned keyboard caps (⌘ ⌥ ↵ ↑ ↓ — no ⇧/⌫/⇥/←/→). */
export function isMacPlatform(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        /Mac|iPhone|iPad/.test(navigator.platform ?? '')
    )
}

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
}

/**
 * Split a stored combo into display caps. Accepts the app's keybinding syntax:
 *   "Mod+Shift+D"        → [["⌘","Shift","D"]]        a chord
 *   "Mod+`, Mod+J"       → [["⌘","`"], ["⌘","J"]]     a sequence (comma-separated)
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
