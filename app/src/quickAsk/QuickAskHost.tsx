// app/src/quickAsk/QuickAskHost.tsx — the only importer of QuickAsk. No stylesheet of its own: it
// is wiring, not presentation.
// Reads the quick-ask state + the chat registry and renders <QuickAsk> while the popover is open.
// The first question mints the one-off chat id (ONLY for a trusted Enter — `beginQuickAsk`), waits
// for App's retention to create the session, sets the quick-ask instruction + the SESSION-LOCAL
// `default` permission mode, then drafts and sends. A reply sends into that same session. `[ apply ]`
// (trusted click only) flushes the note's unsaved buffer, switches the session to `acceptEdits` and
// sends the apply message — the daemon edits the file itself and the editor reloads it. The chat
// session cannot separate visible text from wire text, so the apply message goes on the wire as is
// and the thread renders it as `> apply` (quickAskTurns). Dropping the session is App's retention's
// job: `closeQuickAsk()` clearing the id is what releases it. Must not import App.tsx.
import {
    createEffect,
    createSignal,
    Show,
    untrack,
    type Component,
} from 'solid-js'
import type { ChatSession } from '../chat/chatSession'
import { setChatInstruction } from '../chat/chatContext'
import { chatSession } from '../chat/chatSessions'
import { daemonName } from '../daemon/daemonIdentityLogic'
import { flushEditorByPath } from '../editorRegistry'
import QuickAsk from './QuickAsk'
import { applyMessage, QUICK_ASK_INSTRUCTION, sendWhenOpen } from './quickAskLogic'
import {
    beginQuickAsk,
    closeQuickAsk,
    handOffQuickAsk,
    quickAskChatId,
    quickAskOpen,
    type QuickAskAnchor,
} from './quickAskState'

export type QuickAskHostProps = {
    daemonEnabled: boolean
    onOpenChat: (chatId: string) => void
    /** Session lookup seam; defaults to the chat registry. A story feeds a fake session here. */
    sessionFor?: (chatId: string) => ChatSession | undefined
    /** Trust seam; defaults to `e.isTrusted`. Only a story overrides it (a play() cannot produce a
     *  trusted event). */
    isTrusted?: (e: Event) => boolean
}

const SEND_RETRY_MS = 100

const QuickAskHost: Component<QuickAskHostProps> = props => {
    const [pending, setPending] = createSignal<string | null>(null)
    const trusted = (e: Event): boolean => (props.isTrusted ?? (ev => ev.isTrusted))(e)
    const session = (): ChatSession | undefined => {
        const id = quickAskChatId()
        return id ? (props.sessionFor ?? chatSession)(id) : undefined
    }

    function send(s: ChatSession, text: string): void {
        const id = untrack(quickAskChatId)
        // The registry opens the /chat socket in the same tick it creates the session, so the first
        // send usually lands while it is CONNECTING and is refused: retry for the popover's lifetime.
        sendWhenOpen(
            {
                setDraft: v => untrack(() => s.setDraft(v)),
                send: () => untrack(() => s.send()),
                draft: () => untrack(() => s.draft()),
                blocked: () => untrack(() => !!(s.setupError() || s.gateRefusal())),
            },
            text,
            () => quickAskChatId() === id,
            fn => setTimeout(fn, SEND_RETRY_MS),
        )
    }

    // The session is created a tick after the id is minted (App's effect): send once it exists.
    createEffect(() => {
        const s = session()
        const q = pending()
        if (!s || q === null) return
        setPending(null)
        const id = untrack(quickAskChatId)
        if (!id) return
        // Before the first send: answer-only instruction + a mode that asks before editing, both
        // local to this session (the persisted default mode is untouched).
        setChatInstruction(id, QUICK_ASK_INSTRUCTION)
        untrack(() => s.setPermissionModeLocal('default'))
        send(s, q)
    })

    function onSubmit(question: string, e: KeyboardEvent): void {
        if (!beginQuickAsk({ isTrusted: trusted(e) })) return
        setPending(question)
    }

    // A follow-up acts on the EXISTING session only; it never mints one.
    function onReply(text: string, e: KeyboardEvent): void {
        if (!trusted(e)) return
        const s = session()
        if (!s || s.streaming()) return
        // An apply left the session in acceptEdits: a follow-up asks again, it does not edit.
        if (s.permMode() !== 'default') untrack(() => s.setPermissionModeLocal('default'))
        send(s, text)
    }

    async function onApply(anchor: QuickAskAnchor, e: MouseEvent): Promise<void> {
        if (!trusted(e) || anchor.kind !== 'caret' || anchor.notePath === null) return
        const s = session()
        const id = quickAskChatId()
        if (!s || !id || s.streaming()) return
        await flushEditorByPath(anchor.notePath)
        if (quickAskChatId() !== id) return
        s.setPermissionModeLocal('acceptEdits')
        send(s, applyMessage(anchor.notePath))
    }

    function refocus(anchor: QuickAskAnchor): void {
        if (anchor.kind === 'caret') anchor.view.focus()
    }

    function onClose(anchor: QuickAskAnchor): void {
        setPending(null)
        closeQuickAsk()
        refocus(anchor)
    }

    function onOpenInChat(): void {
        const id = quickAskChatId()
        if (!id) return
        props.onOpenChat(id)
        setPending(null)
        handOffQuickAsk()
    }

    return (
        <Show when={quickAskOpen()} keyed>
            {anchor => (
                <QuickAsk
                    {...{ anchor, onSubmit, onOpenInChat, onReply }}
                    session={session()}
                    daemonEnabled={props.daemonEnabled}
                    name={props.daemonEnabled ? daemonName() : 'chat'}
                    onApply={
                        anchor.kind === 'caret' && anchor.notePath !== null
                            ? e => void onApply(anchor, e)
                            : undefined
                    }
                    onClose={() => onClose(anchor)}
                />
            )}
        </Show>
    )
}

export default QuickAskHost
