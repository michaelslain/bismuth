// app/src/quickAsk/quickAskState.ts
// Module-level state for the Cmd+K quick-ask popover — plain Solid signals, the same singleton
// pattern as daemon/daemonChatArm.ts. Two separate facts:
//   - `quickAskOpen`  : the popover is showing, and where it is anchored.
//   - `quickAskChatId`: the chat the popover shows. Each anchor KEY (the note the caret is in, or
//     the focused pane's content) remembers its chat (`QuickChatEntry`, persisted per browser), so
//     Cmd+K in the same file resumes the same conversation; a key with none mints `quick-<uuid>`.
// App retains `quickAskChatId()` in the chat registry (chat/chatSessions.ts) while the popover is
// open, and the session resumes its conversation from chatSessionStore on creation. Opening is
// reachable only from a person: `quick-ask` is in UI_CONTROL_BLOCKLIST, so app control can never
// start or resume a session through it. `closeQuickAsk` releases the session (App's retention
// disposes it) and keeps the remembered chat unless asked to forget it; `handOffQuickAsk` gives the
// chat to a chat tab, which owns it from then on.
import { createSignal } from 'solid-js'
import type { EditorView } from '@codemirror/view'
import { setChatInstruction } from '../chat/chatContext'
import { forgetChatSession } from '../chat/chatSessionStore'
import { browserStorage, forgetProvider } from '../chat/chatSessionPrefs'
import { readArray, writeCache } from '../viewCache'
import {
    forgetQuickChatEntry,
    quickChatFor,
    rememberQuickChat,
    type QuickChatEntry,
} from './quickAskLogic'

export type QuickAskAnchor = (
    | { kind: 'caret'; view: EditorView; pos: number; notePath: string | null }
    | { kind: 'pane'; leafId: string | null }
) & {
    /** What the remembered chat is keyed by: the note path, or the focused pane's content. Null
     *  (nothing to key by) always starts a fresh chat that is not remembered. */
    key: string | null
}

const STORE_KEY = 'bismuth-quick-ask-chats-v1'

function isEntry(x: unknown): x is QuickChatEntry {
    return (
        !!x &&
        typeof x === 'object' &&
        typeof (x as QuickChatEntry).chatId === 'string' &&
        typeof (x as QuickChatEntry).key === 'string'
    )
}
// This window's copy is the source of truth, loaded once and written through: another window (or
// a story in another tab) writing its own list must not drop this window's remembered chats.
let entries: QuickChatEntry[] | null = null
const readEntries = (): QuickChatEntry[] =>
    (entries ??= readArray(STORE_KEY, isEntry))
const writeEntries = (list: QuickChatEntry[]): void => {
    entries = list
    writeCache(STORE_KEY, list)
}

const [open, setOpen] = createSignal<QuickAskAnchor | null>(null)
const [chatId, setChatId] = createSignal<string | null>(null)

/** Reactive: the open popover's anchor, or null when closed. */
export const quickAskOpen = open

/** Reactive: the chat the open popover shows, null while closed. */
export const quickAskChatId = chatId

/** Drop every trace of a quick chat: its resume entry, its provider key and its remembered slot. */
function forgetQuickChat(id: string): void {
    setChatInstruction(id, null)
    writeEntries(forgetQuickChatEntry(readEntries(), id))
    // Twice: the disposing session can still land a late `session` frame (chatSession.ts
    // rememberChatSession) before its socket closes.
    const forget = (): void => {
        forgetChatSession(id)
        forgetProvider(browserStorage(), id)
    }
    forget()
    setTimeout(forget, 0)
}

/** Open the popover at `anchor` on the chat remembered for its key, or a fresh one. Re-opening
 *  while open re-anchors (and switches chat when the key differs). */
export function openQuickAsk(anchor: QuickAskAnchor): string {
    const prev = chatId()
    const remembered =
        anchor.key === null ? null : quickChatFor(readEntries(), anchor.key)
    const id = remembered ?? `quick-${crypto.randomUUID()}`
    if (anchor.key !== null) {
        const { list, evicted } = rememberQuickChat(
            readEntries(),
            anchor.key,
            id,
        )
        writeEntries(list)
        for (const gone of evicted) forgetQuickChat(gone)
    }
    if (prev && prev !== id) setChatInstruction(prev, null)
    setChatId(id)
    setOpen(anchor)
    return id
}

/** Close the popover and release the session. `forget` (an empty chat, or one not keyed to
 *  anything) also drops the remembered chat so the next Cmd+K starts fresh. */
export function closeQuickAsk(opts: { forget?: boolean } = {}): void {
    const prev = chatId()
    if (prev) {
        const keyed = readEntries().some(e => e.chatId === prev)
        if (opts.forget || !keyed) forgetQuickChat(prev)
        else setChatInstruction(prev, null)
    }
    setChatId(null)
    setOpen(null)
}

/** Hand the chat to a chat tab: returns its id and clears BOTH signals WITHOUT disposing the session
 *  (the caller opens `::chat:<id>`, which keeps it retained). The tab owns the chat from then on, so
 *  the next Cmd+K at that key starts fresh. Null when no id. */
export function handOffQuickAsk(): string | null {
    const id = chatId()
    if (id) {
        setChatInstruction(id, null)
        writeEntries(forgetQuickChatEntry(readEntries(), id))
    }
    setChatId(null)
    setOpen(null)
    return id
}
