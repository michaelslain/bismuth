// app/src/chat/chatSubagents.ts — pure helpers for the agents strip above the composer.
import type { ChatSubagent } from '../../../core/src/chatSubagentTypes'

/** Fold one `subagent` frame into the list: a new id appends, a known id is replaced in place, so
 *  rows keep dispatch order while their status flips. */
export function upsertSubagent(
    list: ChatSubagent[],
    frame: ChatSubagent,
): ChatSubagent[] {
    const at = list.findIndex(a => a.id === frame.id)
    if (at < 0) return [...list, frame]
    return list.map((a, i) => (i === at ? frame : a))
}

