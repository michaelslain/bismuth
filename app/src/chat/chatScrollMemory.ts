// app/src/chat/chatScrollMemory.ts
// Where each chat's transcript was scrolled, so leaving a chat and coming back returns to the same
// place. Only the active tab's panes are mounted, so a tab switch unmounts the transcript and a
// fresh one mounts on return; ChatTranscript saves a spot here as it scrolls and restores it on
// mount. In memory for the app session, keyed by chat id, like scrollMemory.ts for notes.
//
// A spot is a ROW and an offset into it, not a pixel scrollTop: a remounted transcript starts with
// every message as plain text and swaps in its note view as it nears the viewport, so the rows'
// heights change under the restore and a pixel offset would land somewhere else. "At the bottom" is
// its own spot, so a chat left on its live tail comes back on its live tail, however much it grew.

export type ChatScrollSpot =
    | { bottom: true }
    | { bottom: false; row: number; offset: number }

/** Within this many px of the end counts as the bottom (ChatTranscript's follow threshold). */
export const BOTTOM_SLACK = 40

const spots = new Map<string, ChatScrollSpot>()

export function saveChatScroll(chatId: string, spot: ChatScrollSpot): void {
    spots.set(chatId, spot)
}

export function loadChatScroll(chatId: string): ChatScrollSpot | undefined {
    return spots.get(chatId)
}

export function clearChatScroll(chatId: string): void {
    spots.delete(chatId)
}

/** The list's scroll box: `scrollTop`, `scrollHeight`, `clientHeight`. */
export type ScrollBox = {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
}

/** The spot a list is scrolled to. `rowTops` are each row's top in the list's content, ascending;
 *  the row is the last one starting at or above the scroll top. */
export function spotAt(rowTops: readonly number[], box: ScrollBox): ChatScrollSpot {
    if (
        rowTops.length === 0 ||
        box.scrollHeight - box.scrollTop - box.clientHeight < BOTTOM_SLACK
    )
        return { bottom: true }
    let lo = 0
    let hi = rowTops.length - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (rowTops[mid] <= box.scrollTop) lo = mid
        else hi = mid - 1
    }
    return { bottom: false, row: lo, offset: box.scrollTop - rowTops[lo] }
}

/** The scrollTop that shows `spot` given the rows as laid out now. A row that no longer exists (the
 *  chat was replaced underneath) falls back to the bottom. */
export function topFor(
    spot: ChatScrollSpot,
    rowTops: readonly number[],
    box: Omit<ScrollBox, 'scrollTop'>,
): number {
    const bottom = Math.max(0, box.scrollHeight - box.clientHeight)
    if (spot.bottom || spot.row >= rowTops.length) return bottom
    return Math.min(bottom, Math.max(0, rowTops[spot.row] + spot.offset))
}
