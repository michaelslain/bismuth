// Pure: the words for a retry frame. The backend is trying a failed model call again; the
// transcript shows one muted line until the next output or the result clears it.
import type { ChatFrame } from '../../../core/src/chat'

type RetryFrame = Extract<ChatFrame, { type: 'retry' }>

/** "retrying // attempt 2 of 3", or "retrying // attempt 2" when the backend names no cap; a frame
 *  that carries a `note` shows it instead ("retrying // chat condensed to fit the model's window"). */
export function retryLabel(
    frame: Pick<RetryFrame, 'attempt' | 'maxAttempts' | 'note'>,
): string {
    if (frame.note) return `retrying // ${frame.note}`
    const of = frame.maxAttempts ? ` of ${frame.maxAttempts}` : ''
    return `retrying // attempt ${frame.attempt}${of}`
}
