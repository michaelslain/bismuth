// app/src/quickAsk/quickAskLogic.ts
// Pure logic for the quick-ask popover — no framework imports, so it is unit-tested directly.
import type { DaemonMood } from '../daemon/daemonFaceModel'
import { clamp } from '../math'

/** Gap between the caret line and the popover, px. */
export const CARET_GAP = 6
/** Inset kept between the popover and the pane edges, px. */
export const PANE_INSET = 16
/** Distance from the pane top when there is no caret, px. */
export const PANE_TOP_OFFSET = 48
/** Widest the popover gets, px. */
export const MAX_WIDTH = 560
/** Tallest the popover gets, px; past it the transcript scrolls. */
export const MAX_HEIGHT = 560
/** Room below the caret that is always enough to open below it, px. */
export const PREFERRED_ROOM = 320

/** The popover's width for a pane of `paneWidth`: `min(MAX_WIDTH, pane − 2 × inset)`. */
export function popoverWidth(paneWidth: number): number {
    return Math.max(0, Math.min(MAX_WIDTH, paneWidth - PANE_INSET * 2))
}

/** The instruction line the quick-ask session carries in its preamble (see chatContext.ts). */
export const QUICK_ASK_INSTRUCTION =
    'quick ask from the editor — answer in a few short lines. do not edit, create or delete any file until the user presses apply; when you suggest a change to the note, say exactly what you would change.'

/** The wire text `[ apply ]` sends. */
export function applyMessage(notePath: string): string {
    return `apply the change you suggested to ${notePath} — edit the file directly, then reply with one line saying what changed`
}

/** One remembered quick-ask chat: the anchor key it belongs to (a note path, or the focused pane's
 *  content) and its chat id. Stored most-recent last. */
export type QuickChatEntry = { chatId: string; key: string }

/** How many anchor keys keep a resumable chat. Well under the chat session store's own cap, so
 *  quick asks never evict a chat tab's resume entry. */
export const QUICK_CHAT_CAP = 20

/** The chat id remembered for `key`, or null. */
export function quickChatFor(
    list: readonly QuickChatEntry[],
    key: string,
): string | null {
    return list.find(e => e.key === key)?.chatId ?? null
}

/** Remember `chatId` for `key` (most-recent last, one entry per key and per id). Returns the new
 *  list and the ids that fell off the end, so the caller can forget their sessions too. */
export function rememberQuickChat(
    list: readonly QuickChatEntry[],
    key: string,
    chatId: string,
    cap = QUICK_CHAT_CAP,
): { list: QuickChatEntry[]; evicted: string[] } {
    const next = list.filter(e => e.key !== key && e.chatId !== chatId)
    const replaced = list
        .filter(e => e.key === key && e.chatId !== chatId)
        .map(e => e.chatId)
    next.push({ chatId, key })
    const over = Math.max(0, next.length - cap)
    return {
        list: next.slice(over),
        evicted: [...replaced, ...next.slice(0, over).map(e => e.chatId)],
    }
}

/** Drop the entry holding `chatId`. */
export function forgetQuickChatEntry(
    list: readonly QuickChatEntry[],
    chatId: string,
): QuickChatEntry[] {
    return list.filter(e => e.chatId !== chatId)
}

/** The daemon face's mood for the popover header. */
export function faceMood(input: {
    daemonEnabled: boolean
    streaming: boolean
    hasReplyText: boolean
    typing: boolean
}): DaemonMood {
    if (!input.daemonEnabled) return 'asleep'
    if (input.streaming) return input.hasReplyText ? 'talking' : 'thinking'
    if (input.typing) return 'listening'
    return 'idle'
}

type Rect = { left: number; top: number; width: number; height: number }

/** Where the popover's top-left goes, which side of the caret it sits on, and the tallest it may
 *  grow. With a caret: below the caret line (`CARET_GAP` under it) when there is `PREFERRED_ROOM`
 *  below or at least as much as above, else above it (bottom edge `CARET_GAP` over the caret line);
 *  the side depends only on the room, never on the popover's size, so growth never flips it. Left
 *  edge at the caret's x. With no caret: centred, `PANE_TOP_OFFSET` from the pane top. Always
 *  clamped inside the pane with `PANE_INSET`; `maxHeight` is the room on the chosen side, capped at
 *  `MAX_HEIGHT`. Coordinates are viewport (fixed) coordinates, like the inputs. */
export function popoverPlacement(input: {
    caret: { left: number; top: number; bottom: number } | null
    pane: Rect
    size: { width: number; height: number }
}): {
    left: number
    top: number
    side: 'above' | 'below' | 'pane-top'
    maxHeight: number
} {
    const { caret, pane, size } = input
    const minLeft = pane.left + PANE_INSET
    const maxLeft = pane.left + pane.width - PANE_INSET - size.width
    const minTop = pane.top + PANE_INSET
    const bottom = pane.top + pane.height - PANE_INSET
    const maxTop = bottom - size.height
    const cap = (room: number) => Math.max(0, Math.min(MAX_HEIGHT, room))
    // `clamp` returns `lo` when the popover is bigger than the pane — pinned to the inset corner.
    if (!caret) {
        const top = clamp(pane.top + PANE_TOP_OFFSET, minTop, maxTop)
        return {
            left: clamp(
                pane.left + (pane.width - size.width) / 2,
                minLeft,
                maxLeft,
            ),
            top,
            side: 'pane-top',
            maxHeight: cap(
                bottom - Math.max(minTop, pane.top + PANE_TOP_OFFSET),
            ),
        }
    }
    const left = clamp(caret.left, minLeft, maxLeft)
    const belowTop = caret.bottom + CARET_GAP
    const roomBelow = bottom - belowTop
    const roomAbove = caret.top - CARET_GAP - minTop
    const side =
        roomBelow >= PREFERRED_ROOM || roomBelow >= roomAbove
            ? 'below'
            : 'above'
    if (side === 'above')
        return {
            left,
            top: Math.max(caret.top - CARET_GAP - size.height, minTop),
            side,
            maxHeight: cap(roomAbove),
        }
    return {
        left,
        top: clamp(belowTop, minTop, maxTop),
        side,
        maxHeight: cap(roomBelow),
    }
}

export type SendTarget = {
    setDraft: (v: string) => void
    send: () => void
    draft: () => string
    blocked: () => boolean
}

/** Keep trying to send `q` until the session accepts it (its draft clears), it is blocked (setup
 *  error / gate refusal — the popover renders that), or `isLive()` turns false. No retry cap: the
 *  loop is bounded by the popover's lifetime. The first send usually lands while the /chat socket
 *  is still CONNECTING, so `send()` refuses and leaves the draft in place. */
export function sendWhenOpen(
    t: SendTarget,
    q: string,
    isLive: () => boolean,
    schedule: (fn: () => void) => void,
): void {
    const attempt = (): void => {
        if (!isLive()) return
        t.setDraft(q)
        t.send()
        if (t.draft().trim() === '' || t.blocked()) return
        schedule(attempt)
    }
    attempt()
}

/** How far a press may travel and still be a click, px. Past it, it is a drag. */
export const CLICK_SLOP = 4

/** True when a press that went down at `down` and up at `up` is a click, not a drag. */
export function isClick(
    down: { x: number; y: number },
    up: { x: number; y: number },
): boolean {
    return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP
}
