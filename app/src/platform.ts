// app/src/platform.ts
// The one platform check. Cycle-free on purpose (imports nothing) so App.tsx, appWindow.ts and
// ui/ascii/parseCombo.ts can all share it.

/** True on macOS/iPadOS/iOS — decides the overlay titlebar chrome and ⌘/⌥ glyphs vs Ctrl/Alt text. */
export function isMacPlatform(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        /Mac|iPhone|iPad|iPod/.test(
            navigator.platform || navigator.userAgent || '',
        )
    )
}

/** True on Windows — the one engine (WebView2) whose native drag positions are physical px. */
export function isWindowsPlatform(): boolean {
    return (
        typeof navigator !== 'undefined' &&
        /Win/.test(navigator.platform || navigator.userAgent || '')
    )
}
