// app/src/quickAsk/quickAskLogic.ts
// Pure logic for the quick-ask popover — no framework imports, so it is unit-tested directly.
import type { TurnItem } from '../chat/chatTranscriptLogic'
import type { DaemonMood } from '../daemon/daemonFaceModel'
import { clamp } from '../math'

/** Gap between the caret line and the popover, px. */
export const CARET_GAP = 6
/** Inset kept between the popover and the pane edges, px. */
export const PANE_INSET = 16
/** Distance from the pane top when there is no caret, px. */
export const PANE_TOP_OFFSET = 48
/** Widest the popover gets, px. */
export const MAX_WIDTH = 480

/** The popover's width for a pane of `paneWidth`: `min(480, pane − 2 × inset)`. */
export function popoverWidth(paneWidth: number): number {
    return Math.max(0, Math.min(MAX_WIDTH, paneWidth - PANE_INSET * 2))
}

/** The instruction line the quick-ask session carries in its preamble (see chatContext.ts). */
export const QUICK_ASK_INSTRUCTION =
    'quick ask from the editor — answer in a few short lines. do not edit, create or delete any file until the user presses apply; when you suggest a change to the note, say exactly what you would change.'

const APPLY_HEAD = 'apply the change you suggested to '
const APPLY_TAIL = ' — edit the file directly, then reply with one line saying what changed'

/** The wire text `[ apply ]` sends. The chat session cannot separate visible text from wire text,
 *  so the thread renders any user line shaped like this as `apply` (see `quickAskTurns`). */
export function applyMessage(notePath: string): string {
    return `${APPLY_HEAD}${notePath}${APPLY_TAIL}`
}

/** True when `text` is exactly an `applyMessage(<some path>)`. */
export function isApplyMessage(text: string): boolean {
    return (
        text.length > APPLY_HEAD.length + APPLY_TAIL.length &&
        text.startsWith(APPLY_HEAD) &&
        text.endsWith(APPLY_TAIL)
    )
}

/** The thread as the popover shows it: user turns with their visible text (an apply message reads
 *  `apply`), assistant turns with their concatenated prose; system items are dropped. */
export function quickAskTurns(
    transcript: readonly TurnItem[],
): { role: 'user' | 'assistant'; text: string }[] {
    const out: { role: 'user' | 'assistant'; text: string }[] = []
    for (const item of transcript) {
        if (item.role === 'user')
            out.push({
                role: 'user',
                text: isApplyMessage(item.text) ? 'apply' : item.text,
            })
        else if (item.role === 'assistant')
            out.push({
                role: 'assistant',
                text: item.parts.map(p => (p.kind === 'text' ? p.text : '')).join(''),
            })
    }
    return out
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

/** Where the popover's top-left goes. With a caret: above it (bottom edge `CARET_GAP` over the
 *  caret line) when there is room inside the pane, else below it; left edge at the caret's x.
 *  With no caret: centred horizontally, `PANE_TOP_OFFSET` from the pane top. Always clamped inside
 *  the pane with `PANE_INSET`. Coordinates are viewport (fixed) coordinates, like the inputs. */
export function popoverPlacement(input: {
    caret: { left: number; top: number; bottom: number } | null
    pane: Rect
    size: { width: number; height: number }
    /** The side chosen at open; once set, later growth never flips it. */
    latched?: 'above' | 'below' | null
}): { left: number; top: number; side: 'above' | 'below' | 'pane-top' } {
    const { caret, pane, size, latched } = input
    const minLeft = pane.left + PANE_INSET
    const maxLeft = pane.left + pane.width - PANE_INSET - size.width
    const minTop = pane.top + PANE_INSET
    const maxTop = pane.top + pane.height - PANE_INSET - size.height
    // `clamp` returns `lo` when the popover is bigger than the pane — pinned to the inset corner.
    if (!caret) {
        return {
            left: clamp(pane.left + (pane.width - size.width) / 2, minLeft, maxLeft),
            top: clamp(pane.top + PANE_TOP_OFFSET, minTop, maxTop),
            side: 'pane-top',
        }
    }
    const left = clamp(caret.left, minLeft, maxLeft)
    const belowTop = caret.bottom + CARET_GAP
    const aboveTop = caret.top - CARET_GAP - size.height
    // Below the caret line is preferred (the popover grows downward, away from the text being
    // written); above only when it does not fit below. A latched side is kept as the popover grows.
    const side = latched ?? (belowTop <= maxTop ? 'below' : aboveTop >= minTop ? 'above' : 'below')
    if (side === 'above') return { left, top: Math.max(aboveTop, minTop), side }
    return { left, top: clamp(belowTop, minTop, maxTop), side }
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
