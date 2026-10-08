// app/src/quickAsk/QuickAskHost.tsx — the only importer of QuickAsk. No stylesheet of its own: it
// is wiring, not presentation.
// Reads the quick-ask state + the chat registry and renders <QuickAsk> while the popover is open.
// Opening picked the chat (quickAskState: the one remembered for this note, or a fresh one) and App
// retains it; once its session exists this sets the quick-ask instruction and the SESSION-LOCAL
// `default` permission mode, so the agent asks before editing. Everything typed goes through the
// chat's own composer. `[ apply ]` (trusted click only) flushes the note's unsaved buffer, switches
// the session to `acceptEdits` and sends the apply message — the daemon edits the file itself and
// the editor reloads it; the mode returns to `default` once that turn ends. Closing releases the
// session (App's retention disposes it) and forgets a chat nobody wrote in. Must not import App.tsx.
import { createEffect, on, Show, untrack, type Component } from 'solid-js'
import type { ChatSession } from '../chat/chatSession'
import { setChatInstruction } from '../chat/chatContext'
import { chatSession } from '../chat/chatSessions'
import { daemonName } from '../daemon/daemonIdentityLogic'
import type { NoteCandidate } from '../editor/wikilink'
import type { MemoryCandidate } from '../../../core/src/memoryRef'
import { flushEditorByPath } from '../editorRegistry'
import QuickAsk from './QuickAsk'
import { applyMessage, QUICK_ASK_INSTRUCTION } from './quickAskLogic'
import {
    closeQuickAsk,
    handOffQuickAsk,
    quickAskChatId,
    quickAskOpen,
    type QuickAskAnchor,
} from './quickAskState'

export type QuickAskHostProps = {
    daemonEnabled: boolean
    onOpenChat: (chatId: string) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    /** An in-app drag is over the popover (App's viewDrag resolved its `data-chat-drop`). */
    dragOver?: boolean
    /** Session lookup seam; defaults to the chat registry. A story feeds a fake session here. */
    sessionFor?: (chatId: string) => ChatSession | undefined
    /** Trust seam; defaults to `e.isTrusted`. Only a story overrides it (a play() cannot produce a
     *  trusted event). */
    isTrusted?: (e: Event) => boolean
}

const QuickAskHost: Component<QuickAskHostProps> = props => {
    const trusted = (e: Event): boolean =>
        (props.isTrusted ?? (ev => ev.isTrusted))(e)
    const session = (): ChatSession | undefined => {
        const id = quickAskChatId()
        return id ? (props.sessionFor ?? chatSession)(id) : undefined
    }

    // Each time a quick-ask session appears (a fresh chat, or one resumed on reopen): answer-only
    // instruction + a mode that asks before editing, both local to this session.
    createEffect(
        on(session, s => {
            const id = untrack(quickAskChatId)
            if (!s || !id) return
            setChatInstruction(id, QUICK_ASK_INSTRUCTION)
            untrack(() => s.setPermissionModeLocal('default'))
        }),
    )

    // An apply leaves the session in acceptEdits only for its own turn: back to `default` when it
    // ends, so a follow-up asks again rather than editing.
    let applying = false
    createEffect(
        on(
            () => session()?.streaming() ?? false,
            (busy, wasBusy) => {
                if (!applying || busy || !wasBusy) return
                applying = false
                const s = untrack(session)
                if (s && s.permMode() !== 'default')
                    untrack(() => s.setPermissionModeLocal('default'))
            },
        ),
    )

    async function onApply(
        anchor: QuickAskAnchor,
        e: MouseEvent,
    ): Promise<void> {
        if (!trusted(e) || anchor.kind !== 'caret' || anchor.notePath === null)
            return
        const s = session()
        const id = quickAskChatId()
        if (!s || !id || s.streaming()) return
        await flushEditorByPath(anchor.notePath)
        if (quickAskChatId() !== id) return
        s.setPermissionModeLocal('acceptEdits')
        applying = true
        // The session sends its draft: lend it the apply message, then give back what was typed.
        const typed = s.draft()
        s.setDraft(applyMessage(anchor.notePath))
        s.send()
        if (s.draft() === '') s.setDraft(typed)
    }

    function refocus(anchor: QuickAskAnchor): void {
        if (anchor.kind === 'caret') anchor.view.focus()
    }

    function onClose(anchor: QuickAskAnchor): void {
        const s = session()
        // A chat nobody wrote in is not worth resuming.
        const empty = !s || !s.transcript.some(i => i.role === 'user')
        applying = false
        closeQuickAsk({ forget: empty })
        refocus(anchor)
    }

    function onOpenInChat(): void {
        const id = quickAskChatId()
        if (!id) return
        props.onOpenChat(id)
        handOffQuickAsk()
    }

    return (
        <Show when={quickAskOpen()} keyed>
            {anchor => (
                <Show when={quickAskChatId()} keyed>
                    {chatId => (
                        <QuickAsk
                            {...{ anchor, chatId, onOpenInChat }}
                            session={session()}
                            daemonEnabled={props.daemonEnabled}
                            name={props.daemonEnabled ? daemonName() : 'chat'}
                            noteNames={props.noteNames}
                            memoryNames={props.memoryNames}
                            tagNames={props.tagNames}
                            dragOver={props.dragOver}
                            onApply={
                                anchor.kind === 'caret' &&
                                anchor.notePath !== null
                                    ? e => void onApply(anchor, e)
                                    : undefined
                            }
                            onClose={() => onClose(anchor)}
                        />
                    )}
                </Show>
            )}
        </Show>
    )
}

export default QuickAskHost
