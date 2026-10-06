// app/src/chat/chatAvatar.ts
// Pure decisions behind the bot's avatar in ChatTranscript: the daemon face (.:[00]:.) sits on the
// LOWEST assistant row only — every earlier assistant turn carries just the name — and animates by
// the chat's own liveness. No Solid imports — see chatAvatar.test.ts.
import type { TurnItem } from './chatTranscriptLogic'
import { deriveMood, type DaemonMood } from '../daemon/daemonFaceModel'

/** Index of the item that carries the face, or -1 when none does. While a reply is awaited the
 *  transient "working" row below the list is the lowest assistant row, so it takes the face and
 *  no item does. Otherwise the last assistant item — a user turn or system note after it does not
 *  move the face, since neither is the bot talking. */
export function avatarIndex(
    items: readonly TurnItem[],
    awaitingReply: boolean,
): number {
    if (awaitingReply) return -1
    for (let i = items.length - 1; i >= 0; i--)
        if (items[i].role === 'assistant') return i
    return -1
}

export type ChatLiveness = {
    /** A reply is streaming (or pending). */
    busy: boolean
    /** Reply TEXT is streaming — talking rather than thinking. */
    speaking: boolean
    /** The user has a non-empty draft. */
    composing: boolean
}

/** The face's mood for a plain chat — the daemon page's full mood minus the daemon-only inputs
 *  (crons, inbox, failures), so thinking / talking / listening / idle. */
export function chatAvatarMood(live: ChatLiveness): DaemonMood {
    return deriveMood({
        enabled: true,
        running: true,
        cronsRunning: 0,
        recentFailure: false,
        inboxDue: 0,
        inboxWorking: false,
        chatBusy: live.busy,
        chatSpeaking: live.speaking,
        composing: live.composing,
    })
}
