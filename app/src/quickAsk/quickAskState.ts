// app/src/quickAsk/quickAskState.ts
// Module-level state for the Cmd+K quick-ask popover — plain Solid signals, the same singleton
// pattern as daemon/daemonChatArm.ts. Two separate facts:
//   - `quickAskOpen`  : the popover is showing, and where it is anchored. Opening creates NO session.
//   - `quickAskChatId`: the one-off chat id, minted ONLY by `beginQuickAsk` on a TRUSTED event (a
//     real Enter keydown in the popover input). Open via a command, a keybinding handler or app
//     control and the id stays null, so no agent session can be started without a person typing.
// App retains `quickAskChatId()` in the chat registry (chat/chatSessions.ts); `closeQuickAsk`
// clearing it is what releases the session, `handOffQuickAsk` clears it WITHOUT disposing (the
// chat tab takes the id over).
import { createSignal } from 'solid-js'
import type { EditorView } from '@codemirror/view'
import { setChatInstruction } from '../chat/chatContext'
import { forgetChatSession } from '../chat/chatSessionStore'
import { browserStorage, forgetProvider } from '../chat/chatSessionPrefs'

export type QuickAskAnchor =
    | { kind: 'caret'; view: EditorView; pos: number; notePath: string | null }
    | { kind: 'pane'; leafId: string | null }

const [open, setOpen] = createSignal<QuickAskAnchor | null>(null)
const [chatId, setChatId] = createSignal<string | null>(null)

/** Reactive: the open popover's anchor, or null when closed. */
export const quickAskOpen = open

/** Reactive: the one-off chat id, null until a trusted Enter and again after close / hand-off. */
export const quickAskChatId = chatId

/** A one-off id must not outlive its popover: the session store is capped (oldest dropped), so ~50
 *  asks would evict real chat tabs' resume entries, and each leaves a permanent provider key. Runs
 *  once now and once next tick, because the disposing session can still land a late `session` frame
 *  (chatSession.ts rememberChatSession) before its socket closes. */
function forgetQuickChat(id: string): void {
    // The quick-ask instruction must not outlive the popover (a handed-off chat behaves like any chat).
    setChatInstruction(id, null)
    const forget = (): void => {
        forgetChatSession(id)
        forgetProvider(browserStorage(), id)
    }
    forget()
    setTimeout(forget, 0)
}

/** Open the popover at `anchor`. Never creates a chat session. Re-opening while open re-anchors
 *  and starts over (a fresh question), dropping any previous id. */
export function openQuickAsk(anchor: QuickAskAnchor): void {
    const prev = chatId()
    if (prev) forgetQuickChat(prev)
    setChatId(null)
    setOpen(anchor)
}

/** Close the popover and release the chat id (App's retention then disposes the session). */
export function closeQuickAsk(): void {
    const prev = chatId()
    if (prev) forgetQuickChat(prev)
    setChatId(null)
    setOpen(null)
}

/** Mint `quick-<uuid>` iff `e` is a trusted event; otherwise null and no state changes. An
 *  already-minted id is returned as is — one popover is one question. */
export function beginQuickAsk(e: { isTrusted: boolean }): string | null {
    if (e.isTrusted !== true) return null
    const existing = chatId()
    if (existing) return existing
    const id = `quick-${crypto.randomUUID()}`
    setChatId(id)
    return id
}

/** Hand the one-off chat to a chat tab: returns its id and clears BOTH signals WITHOUT disposing
 *  the session (the caller opens `::chat:<id>`, which keeps it retained). Null when no id. */
export function handOffQuickAsk(): string | null {
    const id = chatId()
    if (id) setChatInstruction(id, null)
    setChatId(null)
    setOpen(null)
    return id
}
