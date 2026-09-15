// app/src/overlayHosts.ts
// A nudge for App's overlay measurement. App re-measures every `[data-terminal-host]` placeholder
// when the ACTIVE TAB changes — which covers a placeholder rendered synchronously by PaneContent. A
// placeholder that mounts LATER, with no tab change, is invisible to that: one inside a lazy route,
// or one toggled by state. Such a placeholder calls requestOverlayMeasure() on mount and cleanup;
// App tracks the version in its measure effect, so the overlay re-measures and rebinds its per-host
// ResizeObserver. (Chats no longer use an overlay — the chat tab renders inline, its session held
// by chat/chatSessions.ts.)
import { createSignal } from 'solid-js'

const [version, setVersion] = createSignal(0)

/** Reactive: bumps each time a late-mounting overlay host asks to be measured. */
export const overlayHostsVersion = version

/** Ask App to re-measure every overlay host placeholder (and re-observe them). */
export function requestOverlayMeasure(): void {
    setVersion(v => v + 1)
}
