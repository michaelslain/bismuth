// app/src/chat/_fakeChatSocket.ts
// Story fixture: a fake `/chat` WebSocket that replays a static `ChatFrame[]`, so a chat session can
// be driven in Storybook with no Agent-SDK session, no `claude` binary and no backend. Moved out of
// ChatView.stories.tsx so every chat story shares one copy.
//
// It matches only the surface chatSession.ts touches: the on* handler properties, `.send()`,
// `.close()`, `.readyState`, and the OPEN/etc numeric statics (`sendJson` guards on
// `ws.readyState !== WebSocket.OPEN`; with the global replaced, the bare `WebSocket` identifier
// resolves to THIS class, so the statics must exist). /chat frames are JSON TEXT, so each frame goes
// down as its own stringified message, exactly as core/src/chat.ts pushes them.
//
// ORDER MATTERS: a session connects the moment it is created, so install the fake BEFORE retaining
// the session, and restore it only after releasing. A leaked global corrupts every story loaded
// afterwards in the same Storybook. `retainFakeChat(chatId, frames)` below is the one place that
// sequence is written — call it synchronously in a component body instead of writing the sequence
// out again.
//
// `retainChatSessions(ids)` means "exactly these ids" — it disposes every session NOT in the list —
// so two stories that both call it with their own single id, mounted together (e.g. a docs page
// rendering several stories at once), dispose each other's sessions out from under them. Each story
// owns its retain/release pair and must not assume another story's session stays alive.
import { onCleanup } from 'solid-js'
import { forgetChatSession } from './chatSessionStore'
import { retainChatSessions } from './chatSessions'
import type { ChatFrame } from '../../../core/src/chat'

/** A fixed script replayed on every connect, or one script per backend — the latter answers the
 *  session's `{type:"open", provider}` with that provider's frames, so a story can switch connector
 *  in the model picker and see THAT connector's models instead of the first one's. */
export type FakeChatFrames =
    readonly ChatFrame[] | ((provider: string) => readonly ChatFrame[])

export function makeFakeChatSocketClass(frames: FakeChatFrames) {
    return class FakeChatSocket {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSING = 2
        static readonly CLOSED = 3

        readyState = FakeChatSocket.CONNECTING
        binaryType: 'blob' | 'arraybuffer' = 'blob'
        onopen: ((ev: Event) => void) | null = null
        onmessage: ((ev: MessageEvent) => void) | null = null
        onclose: ((ev: CloseEvent) => void) | null = null
        onerror: ((ev: Event) => void) | null = null

        constructor(public url: string) {
            // Defer past the current microtask: the session assigns its handlers synchronously right
            // after `new WebSocket(...)` returns, and a real socket never opens inside its constructor.
            queueMicrotask(() => {
                if (this.readyState === FakeChatSocket.CLOSED) return
                this.readyState = FakeChatSocket.OPEN
                // The session's onopen sends `{type:"open"}`; a real backend then streams frames back.
                this.onopen?.(new Event('open'))
                if (typeof frames !== 'function') this.replay(frames)
            })
        }

        private replay(script: readonly ChatFrame[]): void {
            for (const frame of script) {
                this.onmessage?.({
                    data: JSON.stringify(frame),
                } as unknown as MessageEvent)
            }
        }

        send(...args: unknown[]): void {
            // No backend on the other end. A per-provider script is the one exception: the session's
            // `{type:"open", provider}` picks which script answers, as the real router would.
            if (typeof frames !== 'function' || typeof args[0] !== 'string')
                return
            let msg: { type?: string; provider?: string }
            try {
                msg = JSON.parse(args[0])
            } catch {
                return
            }
            if (msg.type !== 'open') return
            const script = frames(msg.provider ?? 'claude')
            queueMicrotask(() => {
                if (this.readyState === FakeChatSocket.OPEN) this.replay(script)
            })
        }

        close(): void {
            // Deliberately does NOT fire `onclose` — the session's onclose schedules a backoff
            // reconnect, which would respawn the socket (and replay every frame) after the story ends.
            this.readyState = FakeChatSocket.CLOSED
        }
    }
}

/** Installs the fake as `globalThis.WebSocket`; returns a restore function. */
export function installFakeChatSocket(frames: FakeChatFrames): () => void {
    const original = globalThis.WebSocket
    globalThis.WebSocket = makeFakeChatSocketClass(
        frames,
    ) as unknown as typeof WebSocket
    return () => {
        globalThis.WebSocket = original
    }
}

/** The order-matters sequence every fake-chat story needs: install the fake socket, forget any
 *  remembered session for `chatId` (a remembered id resumes over HTTP instead of connecting fresh),
 *  then retain it — and register the reverse sequence with `onCleanup`. Call synchronously inside
 *  a component body, before anything reads the session registry. */
export function retainFakeChat(
    chatId: string,
    frames: FakeChatFrames = [],
): void {
    const restore = installFakeChatSocket(frames)
    forgetChatSession(chatId)
    retainChatSessions([chatId])
    onCleanup(() => {
        retainChatSessions([])
        forgetChatSession(chatId)
        restore()
    })
}
