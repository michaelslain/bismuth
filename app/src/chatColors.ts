// app/src/chatColors.ts
// Per-chat pane TINT color, keyed by the chat TAB id (the ::chat:<uuid> content id's suffix — the
// durable identity that survives a close/reopen round-trip through serializeTabs) and PERSISTED in
// localStorage so a chosen color survives a reload AND a Cmd+Shift+T reopen, mirroring
// chatSessionStore.ts / chatTitles.ts. Signal-backed so ChatView re-tints its pane the instant the
// color is picked (the tab context menu sets it while the chat is open).
//
// The value is a CSS color string (one of CHAT_COLOR_SWATCHES); ChatView washes it into the pane's
// --bg via color-mix, so the WHOLE chat pane reads as that color while text stays legible. Clearing
// (setChatColor(id, null)) drops the entry and reverts the pane to the theme background.
import { createSignal } from 'solid-js'
import { createChatKeyedStore } from './chatKeyedStore'
import { parseHex } from './color/parseHex'

const KEY = 'bismuth-chat-colors-v1'
const CAP = 200

/** One chat TAB id → its pane tint color (a CSS color string). */
export interface ChatColorEntry {
    chatId: string
    color: string
}

function isColorEntry(x: unknown): x is ChatColorEntry {
    return (
        !!x &&
        typeof x === 'object' &&
        typeof (x as ChatColorEntry).chatId === 'string' &&
        typeof (x as ChatColorEntry).color === 'string'
    )
}

const store = createChatKeyedStore<ChatColorEntry>(KEY, CAP, isColorEntry)

/** The preset tints offered in the chat tab's Color menu. Saturated hues that read over BOTH the
 *  light and dark theme backgrounds once washed in via color-mix. `null` = clear (theme default). */
export const CHAT_COLOR_SWATCHES: { name: string; value: string }[] = [
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Green', value: '#22c55e' },
    { name: 'Teal', value: '#14b8a6' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Purple', value: '#a855f7' },
    { name: 'Pink', value: '#ec4899' },
]

/** Pure upsert: drop any existing entry for `chatId`, append the new one (most-recent last), cap the
 *  list (oldest dropped). A null/empty color REMOVES the entry (clear). Exported for unit testing. */
export function upsertColor(
    list: ChatColorEntry[],
    chatId: string,
    color: string | null,
    cap = CAP,
): ChatColorEntry[] {
    return color
        ? store.upsert(list, chatId, { chatId, color }, cap)
        : store.remove(list, chatId)
}

/** Resolve a `/color <token>` argument (Row 75) to a STORED tint value: a named swatch
 *  (case-insensitive, e.g. `blue`), a `#rgb`/`#rrggbb` hex (e.g. `#ffcc00`), or one of the clear
 *  keywords (`none`/`clear`/`off`/`default`/`reset` → null, revert to the theme background). Returns
 *  `undefined` for an unrecognized token so the caller can surface an error instead of silently
 *  doing nothing. Pure + exported for unit testing. */
export function resolveChatColorArg(token: string): string | null | undefined {
    const t = token.trim()
    if (!t || /^(none|clear|off|default|reset)$/i.test(t)) return null
    const swatch = CHAT_COLOR_SWATCHES.find(
        s => s.name.toLowerCase() === t.toLowerCase(),
    )
    if (swatch) return swatch.value
    if (parseHex(t) !== null) return t
    return undefined
}

/** Pure lookup: the remembered color for `chatId`, or null. Reads newest-first so a duplicate
 *  (shouldn't happen after upsert, but be defensive) resolves to the most recent. Exported for tests. */
export function lookupColor(
    list: ChatColorEntry[],
    chatId: string,
): string | null {
    return store.lookup(list, chatId)?.color ?? null
}

// A reactive mirror of the persisted store: the signal drives ChatView's live re-tint, localStorage
// makes it survive reload/reopen. Seeded once from storage on module load.
const [colors, setColors] = createSignal<ChatColorEntry[]>(store.read())

/** The tint color for a chat tab id, or undefined if none was chosen. REACTIVE — read it inside a
 *  ChatView style binding so the pane re-tints when the color changes. */
export function chatColor(chatId: string): string | undefined {
    return lookupColor(colors(), chatId) ?? undefined
}

/** Set (or, with null/empty, clear) a chat tab's pane tint. Persists + updates the live signal. */
export function setChatColor(chatId: string, color: string | null): void {
    if (!chatId) return
    const next = upsertColor(colors(), chatId, color)
    setColors(next)
    store.write(next)
}
