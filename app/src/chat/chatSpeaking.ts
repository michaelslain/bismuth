// app/src/chat/chatSpeaking.ts
// Pure derivation behind chatSession.ts's `publishChatSpeaking` effect: speaking = busy AND the
// trailing part of the last assistant turn is actual streamed text — distinguishes `thinking` (a
// reply is pending, nothing written yet) from `talking` (text is flowing) for the daemon face's
// mood. No Solid imports — see chatSpeaking.test.ts.
//
// A queued follow-up (the user staged another message while streaming, Row 83) appends a `user`
// item with `queued: true` AFTER the streaming assistant turn — so the naive "look at the last
// item" check would see the queued user bubble and stop reporting speaking, even though the
// assistant is still actively talking. Walk back past any trailing queued user bubbles first.
import type { TurnItem } from '../chatTranscript'

export function isSpeaking(
    transcript: readonly TurnItem[],
    streaming: boolean,
): boolean {
    if (!streaming) return false
    let i = transcript.length - 1
    while (i >= 0) {
        const item = transcript[i]
        if (item.role === 'user' && item.queued) {
            i--
            continue
        }
        break
    }
    if (i < 0) return false
    const item = transcript[i]
    if (item.role !== 'assistant') return false
    const lastPart = item.parts[item.parts.length - 1]
    return lastPart?.kind === 'text'
}

export default isSpeaking
