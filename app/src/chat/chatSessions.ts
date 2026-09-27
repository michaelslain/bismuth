// app/src/chat/chatSessions.ts
// The chat session registry: one live ChatSession per retained chat id, so a session's WebSocket,
// transcript, draft and streaming turn outlive any view that renders it. App computes the set of chat
// ids that must stay alive and hands it to `retainChatSessions` from an effect; views look a session
// up with `chatSession(id)`. Each session lives in its OWN `createRoot` — never owned by the effect
// that retained it, so the effect re-running cannot dispose it — and is torn down only when its id
// leaves the retained set.
import { createRoot, createSignal, untrack } from 'solid-js'
import { createChatSession, type ChatSession } from './chatSession'
import { applyChatDrop, type ChatDropAction } from './chatDrop'

// Drops that landed on a chat surface before its session existed (the daemon page's chat is armed by
// the drop itself, and its session is created a tick later). Spent the moment that session appears.
const pendingDrops = new Map<string, ChatDropAction[]>()

type Entry = { session: ChatSession; disposeRoot: () => void }

const entries = new Map<string, Entry>()
// A fresh Map per change so `chatSession()` readers re-run when an id is retained or released.
const [live, setLive] = createSignal<ReadonlyMap<string, ChatSession>>(
    new Map(),
)

/** Make exactly `chatIds` live: create a session (in its own createRoot) for each new id, dispose
 *  every session whose id is absent. Idempotent. Call from an App effect. */
export function retainChatSessions(chatIds: readonly string[]): void {
    untrack(() => {
        const wanted = new Set(chatIds)
        let changed = false
        for (const [id, entry] of entries) {
            if (wanted.has(id)) continue
            entries.delete(id)
            entry.session.dispose()
            entry.disposeRoot()
            changed = true
        }
        for (const id of wanted) {
            if (entries.has(id)) continue
            const entry = createRoot(disposeRoot => ({
                session: createChatSession(id),
                disposeRoot,
            }))
            entries.set(id, entry)
            changed = true
            const queued = pendingDrops.get(id)
            if (queued) {
                pendingDrops.delete(id)
                for (const a of queued) void applyChatDrop(entry.session, a)
            }
        }
        if (changed)
            setLive(new Map([...entries].map(([id, e]) => [id, e.session])))
    })
}

/** Reactive lookup; undefined until retained. Takes the bare chat id (no `::chat:` prefix). */
export function chatSession(chatId: string): ChatSession | undefined {
    return live().get(chatId)
}

/** Hand a drop to chat `chatId`: applied now when its session is live, else queued until
 *  `retainChatSessions` creates it. A queued drop for a chat that never comes up is simply held. */
export function deliverChatDrop(chatId: string, action: ChatDropAction): void {
    const s = entries.get(chatId)?.session
    if (s) {
        void applyChatDrop(s, action)
        return
    }
    const q = pendingDrops.get(chatId) ?? []
    q.push(action)
    pendingDrops.set(chatId, q)
}
