// Visual + behavioural spec for <QuickAskHost>, as a surface a person can use: a pane with two notes
// (switch with `[ fox.md ]` / `[ hen.md ]`) where Cmd/Ctrl+K opens the popover at the caret, exactly
// as App wires it. Each chat id gets its own fake session (fed through the host's `sessionFor` seam),
// so switching notes shows a different conversation and coming back resumes the first. A fake
// session answers whatever is sent with a canned reply after a short delay, so typing in the
// composer and pressing Enter works by hand. Each play() runs its flow and leaves the result open.
//   - A real click cannot be produced by a play() (userEvent is untrusted), so the apply stories
//     hand the host an `isTrusted` seam that says yes; the default-seam story proves the gate refuses.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type { ChatManifest } from '../../../core/src/chat'
import { getChatInstruction } from '../chat/chatContext'
import { makeStubChatSession } from '../chat/_stubChatSession'
import type { ChatSession } from '../chat/chatSession'
import { applyChatFrame, type TurnItem } from '../chat/chatTranscriptLogic'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import QuickAskHost from './QuickAskHost'
import { applyMessage, QUICK_ASK_INSTRUCTION } from './quickAskLogic'
import {
    closeQuickAsk,
    openQuickAsk,
    quickAskChatId,
    quickAskOpen,
    type QuickAskAnchor,
} from './quickAskState'

const meta = {
    title: 'QuickAsk/QuickAskHost',
    component: QuickAskHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof QuickAskHost>

export default meta
type Story = StoryObj<typeof meta>

const NOTES = {
    'notes/fox.md': 'the quick brown fox',
    'notes/hen.md': 'the little red hen',
} as const
type NotePath = keyof typeof NOTES

const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'default',
    slashCommands: ['compact', 'clear'],
    tools: ['Read', 'Write', 'Bash'],
    mcpServers: [{ name: 'bismuth', status: 'connected' }],
}

const MODELS = [
    {
        value: 'opus',
        label: 'Opus 4.8',
        description: 'Most capable',
        effortLevels: ['low', 'medium', 'high'],
    },
    {
        value: 'sonnet',
        label: 'Sonnet 4.8',
        description: 'Fast',
        effortLevels: ['low', 'medium', 'high'],
    },
]

/** The seam: push transcript items / flip streaming on demand. `order` records, in call order,
 *  the mode changes and sends the host makes (with the instruction as seen at send time). */
type Fake = {
    session: ChatSession
    order: string[]
    ask: (text: string) => void
    token: (text: string) => void
    done: () => void
}

function makeFake(id: string, auto: boolean): Fake {
    const [transcript, setTranscript] = createStore<TurnItem[]>([])
    const [streaming, setStreaming] = createSignal(false)
    const [awaitingReply, setAwaitingReply] = createSignal(false)
    const stub = makeStubChatSession({
        chatId: id,
        manifest: MANIFEST,
        models: MODELS,
        displayModel: 'opus',
        displayModelValue: 'opus',
    })
    const order: string[] = []
    const [mode, setMode] = createSignal('bypassPermissions')
    const ask = (text: string): void => {
        setTranscript(produce(t => void t.push({ role: 'user', text })))
        setStreaming(true)
        setAwaitingReply(true)
    }
    const token = (text: string): void => {
        setAwaitingReply(false)
        setTranscript(
            produce(
                t => void applyChatFrame(t, { type: 'assistant-text', text }),
            ),
        )
    }
    const done = (): void => void setStreaming(false)
    return {
        order,
        session: {
            ...stub,
            transcript,
            streaming,
            awaitingReply,
            permMode: mode,
            setPermissionModeLocal: m => {
                setMode(m)
                order.push(`mode:${m}`)
            },
            // Like the real session: a send takes the draft, echoes it as a user turn and streams.
            send: () => {
                const text = stub.draft().trim()
                if (!text || streaming()) return
                order.push(
                    `send:${text}|instruction=${getChatInstruction(id) ? 'on' : 'off'}|mode=${mode()}`,
                )
                stub.setDraft('')
                ask(text)
                if (!auto) return
                setTimeout(() => {
                    token(
                        `A canned story reply. Press Esc, then ⌘K: this conversation comes back.`,
                    )
                    done()
                }, 400)
            },
        },
        ask,
        token,
        done,
    }
}

const fakes = new Map<string, Fake>()
/** The fake behind the open popover. */
const fake = (): Fake => fakes.get(quickAskChatId()!)!
let view: EditorView | undefined
let showNote: ((p: NotePath) => void) | undefined
const onOpenChat = fn()

const caret = (notePath: NotePath | null): QuickAskAnchor => ({
    kind: 'caret',
    view: view!,
    pos: view!.state.doc.length,
    notePath,
    key: notePath,
})

/** Close the way the host does: a chat nobody wrote in is forgotten. */
function closeLikeHost(): void {
    const id = quickAskChatId()
    const empty =
        !id || !fakes.get(id)?.session.transcript.some(i => i.role === 'user')
    closeQuickAsk({ forget: empty })
}

function stage(opts: { trusted?: boolean; auto?: boolean } = {}): JSX.Element {
    fakes.clear()
    const [note, setNote] = createSignal<NotePath>('notes/fox.md')
    const [mounted, setMounted] = createSignal(false)
    let host!: HTMLDivElement
    showNote = (p: NotePath) => {
        if (quickAskOpen()) closeLikeHost()
        setNote(p)
        view?.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: NOTES[p] },
        })
        view?.focus()
    }
    // Cmd/Ctrl+K, the way App binds it: open at the caret, or focus the open popover's composer.
    const onKey = (e: KeyboardEvent) => {
        if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return
        e.preventDefault()
        if (quickAskOpen()) {
            document
                .querySelector<HTMLElement>('[data-quick-ask] .cm-content')
                ?.focus()
            return
        }
        openQuickAsk(caret(note()))
    }
    onMount(() => {
        view = new EditorView({
            state: EditorState.create({ doc: NOTES[note()] }),
            parent: host,
        })
        window.addEventListener('keydown', onKey)
        onCleanup(() => {
            window.removeEventListener('keydown', onKey)
            closeQuickAsk()
            view?.destroy()
        })
        setMounted(true)
    })
    const notePick = (p: NotePath) => (
        <TextButton
            variant={note() === p ? 'selected' : 'unselected'}
            onClick={() => showNote?.(p)}
        >
            {p.slice('notes/'.length)}
        </TextButton>
    )
    return (
        <div
            data-pane-leaf="story-pane"
            data-mounted={mounted() ? '' : undefined}
            style={{
                position: 'relative',
                width: '720px',
                height: '640px',
                margin: '24px',
                border: 'var(--rule)',
                'padding-top': '340px',
                'box-sizing': 'border-box',
                background: 'var(--bg)',
                color: 'var(--fg)',
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    top: '16px',
                    left: '24px',
                    display: 'flex',
                    gap: 'var(--sp-4)',
                    'align-items': 'center',
                }}
            >
                <Text as="span" tone="muted">
                    click the note, press ⌘K // note:
                </Text>
                {notePick('notes/fox.md')}
                {notePick('notes/hen.md')}
            </div>
            <div ref={host} style={{ padding: '0 24px' }} />
            <QuickAskHost
                daemonEnabled
                onOpenChat={onOpenChat}
                noteNames={() => []}
                memoryNames={() => []}
                tagNames={() => []}
                sessionFor={id => {
                    if (!fakes.has(id))
                        fakes.set(id, makeFake(id, opts.auto ?? true))
                    return fakes.get(id)!.session
                }}
                isTrusted={opts.trusted ? () => true : undefined}
            />
        </div>
    )
}

const mounted = (el: HTMLElement) =>
    waitFor(() => expect(el.querySelector('[data-mounted]')).not.toBeNull())

const cmdK = () =>
    window.dispatchEvent(
        new KeyboardEvent('keydown', {
            key: 'k',
            metaKey: true,
            bubbles: true,
        }),
    )

/** Send through the session the popover shows, as the composer's Enter does. */
const say = (text: string) => {
    const s = fake().session
    s.setDraft(text)
    s.send()
}

/** Cmd+K in a note resumes that note's chat; the other note has its own; a chat nobody wrote in
 *  is not kept. Ends on the fox note's popover, its conversation resumed. Try it by hand: ask
 *  something, Esc, Cmd+K again; switch notes and back. */
export const ResumesPerNote: Story = {
    name: 'resumes per note',
    render: () => stage(),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await mounted(canvasElement)
        showNote!('notes/fox.md')
        cmdK()
        await waitFor(() => expect(quickAskChatId()).not.toBeNull())
        const fox = quickAskChatId()!
        say('a sharper word for quick?')
        await body.findByText(/A canned story reply/)
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(quickAskOpen()).toBeNull())

        // Same note: the same chat, its conversation still there.
        cmdK()
        await waitFor(() => expect(quickAskChatId()).toBe(fox))
        await body.findByText('a sharper word for quick?')

        // The other note: its own chat. Leaving it empty forgets it.
        showNote!('notes/hen.md')
        cmdK()
        await waitFor(() => expect(quickAskChatId()).not.toBeNull())
        const hen = quickAskChatId()!
        await expect(hen).not.toBe(fox)
        await expect(body.queryByText('a sharper word for quick?')).toBeNull()
        showNote!('notes/hen.md')
        cmdK()
        await waitFor(() => expect(quickAskChatId()).not.toBeNull())
        await expect(quickAskChatId()).not.toBe(hen)

        // Back to the fox note: resumed.
        showNote!('notes/fox.md')
        cmdK()
        await waitFor(() => expect(quickAskChatId()).toBe(fox))
        await body.findByText('a sharper word for quick?')
    },
}

/** Opening frames the session (instruction + ask-first mode) before anything is sent; apply
 *  flushes -> acceptEdits -> sends the apply message, keeps what was typed, and drops back to
 *  `default` when that turn ends. Ends open, after the apply. */
export const AskThenApply: Story = {
    name: 'ask then apply',
    render: () => stage({ trusted: true, auto: false }),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await mounted(canvasElement)
        showNote!('notes/fox.md')
        cmdK()
        await waitFor(() => expect(fake()?.order).toEqual(['mode:default']))
        const id = quickAskChatId()!
        await expect(getChatInstruction(id)).toBe(QUICK_ASK_INSTRUCTION)

        say('synonym for quick?')
        await expect(fake().order[1]).toBe(
            'send:synonym for quick?|instruction=on|mode=default',
        )
        await expect(body.queryByRole('button', { name: 'apply' })).toBeNull()
        fake().token('**swift** reads best: "the swift brown fox".')
        fake().done()
        await waitFor(() =>
            expect(body.getByRole('button', { name: 'apply' })).toBeEnabled(),
        )

        fake().session.setDraft('half-typed follow-up')
        await userEvent.click(body.getByRole('button', { name: 'apply' }))
        await waitFor(() => expect(fake().order.length).toBe(4))
        await expect(fake().order[2]).toBe('mode:acceptEdits')
        await expect(fake().order[3]).toBe(
            `send:${applyMessage('notes/fox.md')}|instruction=on|mode=acceptEdits`,
        )
        await expect(fake().session.draft()).toBe('half-typed follow-up')
        await expect(view!.state.doc.toString()).toBe(NOTES['notes/fox.md'])

        fake().token('Changed "quick" to "swift" in notes/fox.md.')
        fake().done()
        await waitFor(() => expect(fake().order[4]).toBe('mode:default'))
    },
}

/** The default trust gate: an untrusted [ apply ] click sends nothing and changes no mode. Ends
 *  open, with the reply that apply was refused on. */
export const UntrustedApplyRefused: Story = {
    name: 'untrusted apply refused',
    render: () => stage({ auto: false }),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await mounted(canvasElement)
        showNote!('notes/fox.md')
        cmdK()
        await waitFor(() => expect(fake()?.order).toEqual(['mode:default']))
        fake().ask('synonym for quick?')
        fake().token('**swift**')
        fake().done()
        const apply = await body.findByRole('button', { name: 'apply' })
        await waitFor(() => expect(apply).toBeEnabled())
        await userEvent.click(apply)
        await new Promise(r => setTimeout(r, 150))
        await expect(fake().order).toEqual(['mode:default'])
    },
}

/** Esc closes through closeQuickAsk() and releases the chat id. Cmd+K reopens it. */
export const EscCloses: Story = {
    name: 'esc closes',
    render: () => stage(),
    play: async ({ canvasElement }) => {
        await mounted(canvasElement)
        cmdK()
        await waitFor(() =>
            expect(document.querySelector('[data-quick-ask]')).not.toBeNull(),
        )
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(quickAskOpen()).toBeNull())
        await expect(quickAskChatId()).toBeNull()
    },
}

/** open in chat: hands the id to the app and closes without disposing; the note's next Cmd+K
 *  starts fresh (and ends open on that fresh chat). */
export const OpenInChat: Story = {
    name: 'open in chat',
    render: () => stage(),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await mounted(canvasElement)
        showNote!('notes/hen.md')
        cmdK()
        await waitFor(() => expect(quickAskChatId()).not.toBeNull())
        const id = quickAskChatId()!
        say('hello?')
        await body.findByText(/A canned story reply/)
        await userEvent.click(
            await body.findByRole('button', { name: 'open in chat' }),
        )
        await expect(onOpenChat).toHaveBeenCalledWith(id)
        // The chat tab behaves like any chat: the quick-ask instruction is gone.
        await expect(getChatInstruction(id)).toBeNull()
        await expect(quickAskOpen()).toBeNull()
        cmdK()
        await waitFor(() => expect(quickAskChatId()).not.toBeNull())
        await expect(quickAskChatId()).not.toBe(id)
    },
}
