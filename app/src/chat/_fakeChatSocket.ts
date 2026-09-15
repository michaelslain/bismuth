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
// the session (`installFakeChatSocket(frames)` then `retainChatSessions([id])`), and restore it only
// after releasing. A leaked global corrupts every story loaded afterwards in the same Storybook.
import type { ChatFrame } from '../../../core/src/chat'

export function makeFakeChatSocketClass(frames: readonly ChatFrame[]) {
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
                for (const frame of frames) {
                    this.onmessage?.({
                        data: JSON.stringify(frame),
                    } as unknown as MessageEvent)
                }
            })
        }

        send(..._args: unknown[]): void {
            // Ignore everything the session sends: there is no backend on the other end.
        }

        close(): void {
            // Deliberately does NOT fire `onclose` — the session's onclose schedules a backoff
            // reconnect, which would respawn the socket (and replay every frame) after the story ends.
            this.readyState = FakeChatSocket.CLOSED
        }
    }
}

/** Installs the fake as `globalThis.WebSocket`; returns a restore function. */
export function installFakeChatSocket(
    frames: readonly ChatFrame[],
): () => void {
    const original = globalThis.WebSocket
    globalThis.WebSocket = makeFakeChatSocketClass(
        frames,
    ) as unknown as typeof WebSocket
    return () => {
        globalThis.WebSocket = original
    }
}
