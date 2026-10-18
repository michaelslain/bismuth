// app/src/chat/chatSessions.ts
// The chat session registry: one live ChatSession per retained chat id, so a session's WebSocket,
// transcript, draft and streaming turn outlive any view that renders it. App computes the set of chat
// ids that must stay alive and hands it to `retainChatSessions` from an effect; views look a session
// up with `chatSession(id)`. Each session lives in its OWN `createRoot` — never owned by the effect
// that retained it, so the effect re-running cannot dispose it — and is torn down only when its id
// leaves the retained set.
import { createEffect, createRoot, createSignal, untrack } from 'solid-js'
import { createChatSession, type ChatSession } from './chatSession'
import { applyChatDrop, type ChatDropAction } from './chatDrop'
import { initialBackendChatId } from './chatHandoff'

// Drops that landed on a chat surface before its session existed (the daemon page's chat is armed by
// the drop itself, and its session is created a tick later). Spent the moment that session appears.
const pendingDrops = new Map<string, ChatDropAction[]>()
// Chats asked to send their draft as soon as they are ready (the first-run Obsidian conversion).
// Armed the moment the session appears, like a pending drop.
const pendingSends = new Set<string>()

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
            const backendChatId = initialBackendChatId(
                id,
                new Set(
                    [...entries.values()].map(e => e.session.backendChatId()),
                ),
                () => crypto.randomUUID(),
            )
            const entry = createRoot(disposeRoot => ({
                session: createChatSession(id, { backendChatId }),
                disposeRoot,
            }))
            entries.set(id, entry)
            changed = true
            const queued = pendingDrops.get(id)
            if (queued) {
                pendingDrops.delete(id)
                for (const a of queued) void applyChatDrop(entry.session, a)
            }
            if (pendingSends.delete(id)) sendOnReady(entry.session)
        }
        if (changed)
            setLive(new Map([...entries].map(([id, e]) => [id, e.session])))
    })
}

/** Move chat `from`'s LIVE session to chat id `to` (the daemon page's hand-off): the session keeps
 *  its socket, so a turn in flight keeps streaming and `chatSession(to)` returns it. Returns false
 *  (and changes nothing) when `from` has no live session or `to` already has one. Call it in the same
 *  `batch` that adds `to`'s tab and drops `from` from the retained set, so the retaining effect
 *  sees both at once and neither disposes the moved session nor spawns a new one for `from`. */
export function moveChatSession(from: string, to: string): boolean {
    return untrack(() => {
        const entry = entries.get(from)
        if (!entry || from === to || entries.has(to)) return false
        entries.delete(from)
        entries.set(to, entry)
        entry.session.moveTo(to)
        setLive(new Map([...entries].map(([id, e]) => [id, e.session])))
        return true
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

/** Send chat `chatId`'s draft once the chat is ready to take it: its backend has answered with a
 *  manifest (the socket is open and the agent spawned). Queued when the session does not exist yet.
 *  A chat that never becomes ready keeps the draft, unsent, for the user. */
export function sendChatWhenReady(chatId: string): void {
    const s = entries.get(chatId)?.session
    if (s) sendOnReady(s)
    else pendingSends.add(chatId)
}

function sendOnReady(s: ChatSession): void {
    createRoot(dispose => {
        createEffect(() => {
            if (!s.manifest()) return
            dispose()
            // A microtask later: the session's first-manifest handler sets the permission mode,
            // effort and model right after publishing the manifest, and those must reach the
            // backend before this turn does.
            queueMicrotask(() => s.send())
        })
    })
}
