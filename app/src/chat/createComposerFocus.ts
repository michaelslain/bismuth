// app/src/chat/createComposerFocus.ts
// FOCUS IS THE HOST'S JOB (chat/chatSession.ts never touches the DOM): a session announces
// `onFocusRequest` after a new chat, a provider switch, a history resume, a stop that restores
// queued text, a quote-reply or a drop/mention insertion, and the host answers by focusing then
// scrolling its composer into view. ChatView and DaemonChat both used to hand-roll the same
// `createEffect` + `onCleanup` pair to wire this up — one helper instead of two copies drifting
// apart (final review finding).
//
// Must be called inside a reactive owner (a component body) — it calls createEffect/onCleanup.
import { createEffect, onCleanup, type Accessor } from 'solid-js'
import type { ChatSession } from './chatSession'
import type { ComposerHandle } from '../ChatComposer'

/** Subscribes to `session().onFocusRequest` once both a session and a ready composer handle
 *  exist, focusing then scrolling the composer into view on each request. Re-subscribes whenever
 *  either accessor changes; unsubscribes on cleanup. */
export function createComposerFocus(
    session: Accessor<ChatSession | undefined>,
    handle: Accessor<ComposerHandle | undefined>,
): void {
    createEffect(() => {
        const s = session()
        const h = handle()
        if (!s || !h) return
        onCleanup(
            s.onFocusRequest(() => {
                h.focus()
                h.scrollIntoView()
            }),
        )
    })
}
