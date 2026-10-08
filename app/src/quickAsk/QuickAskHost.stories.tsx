// Visual + behavioural spec for <QuickAskHost>. A fake session (a Solid store the play() pushes
// transcript items into on demand, no timers) is fed through the host's `sessionFor` seam, so the
// whole open -> send -> stream -> done -> reply -> apply flow runs deterministically.
//   - A SYNTHETIC Enter must mint no chat id (the trust gate); this is asserted.
//   - A real Enter / click cannot be produced by a play() (userEvent is untrusted), so the trusted
//     stories hand the host an `isTrusted` seam that says yes; the default-seam stories prove the
//     gate refuses.
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createSignal, onCleanup, onMount, type JSX } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { setChatInstruction, getChatInstruction } from '../chat/chatContext'
import { makeStubChatSession } from '../chat/_stubChatSession'
import type { ChatSession } from '../chat/chatSession'
import { applyChatFrame, type TurnItem } from '../chat/chatTranscriptLogic'
import QuickAskHost from './QuickAskHost'
import { applyMessage, QUICK_ASK_INSTRUCTION } from './quickAskLogic'
import {
    beginQuickAsk,
    closeQuickAsk,
    openQuickAsk,
    quickAskChatId,
    quickAskOpen,
} from './quickAskState'

const meta = {
    title: 'QuickAsk/QuickAskHost',
    component: QuickAskHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof QuickAskHost>

export default meta
type Story = StoryObj<typeof meta>

const DOC = 'the quick brown fox'

/** The seam: push transcript items / flip streaming on demand. `order` records, in call order,
 *  the mode changes and sends the host makes (with the instruction as seen at send time). */
type Fake = {
    session: ChatSession
    calls: Record<string, unknown[][]>
    order: string[]
    ask: (text: string) => void
    token: (text: string) => void
    done: () => void
}

function makeFake(getId: () => string | null): Fake {
    const [transcript, setTranscript] = createStore<TurnItem[]>([])
    const [streaming, setStreaming] = createSignal(false)
    const [awaitingReply, setAwaitingReply] = createSignal(false)
    const stub = makeStubChatSession()
    const order: string[] = []
    const [modeSig, setModeSig] = createSignal('bypassPermissions')
    const mode = (): string => modeSig()
    const ask = (text: string): void => {
        setTranscript(produce(t => void t.push({ role: 'user', text })))
        setStreaming(true)
        setAwaitingReply(true)
    }
    return {
        calls: stub.calls,
        order,
        session: {
            ...stub,
            transcript,
            streaming,
            awaitingReply,
            permMode: modeSig,
            setPermissionModeLocal: m => {
                setModeSig(m)
                order.push(`mode:${m}`)
                stub.setPermissionModeLocal(m)
            },
            // Like the real session: a send takes the draft, echoes it as a user turn and streams.
            send: () => {
                const text = stub.draft()
                const id = getId()
                order.push(
                    `send:${text}|instruction=${id && getChatInstruction(id) ? 'on' : 'off'}|mode=${mode()}`,
                )
                stub.send()
                stub.setDraft('')
                ask(text)
            },
        },
        ask,
        token: text => {
            setAwaitingReply(false)
            setTranscript(produce(t => void applyChatFrame(t, { type: 'assistant-text', text })))
        },
        done: () => setStreaming(false),
    }
}

let fake: Fake | undefined
let view: EditorView | undefined
const onOpenChat = fn()

function stage(trusted = false): JSX.Element {
    fake = makeFake(quickAskChatId)
    const [mounted, setMounted] = createSignal(false)
    let host!: HTMLDivElement
    onMount(() => {
        view = new EditorView({ state: EditorState.create({ doc: DOC }), parent: host })
        onCleanup(() => {
            closeQuickAsk()
            view?.destroy()
        })
        setMounted(true)
    })
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
            <div ref={host} style={{ padding: '0 24px' }} />
            <QuickAskHost
                daemonEnabled
                onOpenChat={onOpenChat}
                sessionFor={() => fake?.session}
                isTrusted={trusted ? () => true : undefined}
            />
        </div>
    )
}

/** The default trust gate: an untrusted Enter mints nothing, an untrusted [ apply ] click sends nothing. */
export const UntrustedRefused: Story = {
    name: 'untrusted enter and apply refused',
    render: () => stage(),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await waitFor(() => expect(canvasElement.querySelector('[data-mounted]')).not.toBeNull())
        openQuickAsk({ kind: 'caret', view: view!, pos: DOC.length, notePath: 'notes/fox.md' })

        // Opening creates no session; the input has focus.
        const input = await body.findByPlaceholderText('ask…')
        await expect(quickAskChatId()).toBeNull()
        await expect(input).toHaveFocus()

        // An untrusted Enter mints nothing and the popover stays an idle row.
        await userEvent.type(input, 'synonym for quick?{Enter}')
        await expect(quickAskChatId()).toBeNull()
        await expect(body.queryByText('working')).toBeNull()
        await expect(fake!.order).toEqual([])

        // A minted session with a finished reply: an untrusted click on apply does nothing.
        await expect(beginQuickAsk({ isTrusted: true })).toMatch(/^quick-/)
        fake!.ask('synonym for quick?')
        fake!.token('**swift**')
        fake!.done()
        const apply = await body.findByRole('button', { name: 'apply' })
        await waitFor(() => expect(apply).toBeEnabled())
        const before = fake!.order.length
        await userEvent.click(apply)
        await new Promise(r => setTimeout(r, 150))
        await expect(fake!.order.length).toBe(before)
        await expect(fake!.order.some(o => o.startsWith('mode:'))).toBe(false)

        // An untrusted Enter in the reply input sends nothing either.
        const replyInput = await body.findByPlaceholderText('reply…')
        await userEvent.type(replyInput, 'again{Enter}')
        await new Promise(r => setTimeout(r, 150))
        await expect(fake!.order.length).toBe(before)
    },
}

/** The trusted path: instruction + local mode set BEFORE the first send, a reply goes into the same
 *  session, and apply flushes -> acceptEdits -> sends the apply message (shown as `> apply`). */
export const AskReplyApply: Story = {
    name: 'ask, reply, apply',
    render: () => stage(true),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await waitFor(() => expect(canvasElement.querySelector('[data-mounted]')).not.toBeNull())
        openQuickAsk({ kind: 'caret', view: view!, pos: DOC.length, notePath: 'notes/fox.md' })
        const input = await body.findByPlaceholderText('ask…')
        await userEvent.type(input, 'synonym for quick?{Enter}')

        const id = quickAskChatId()!
        await expect(id).toMatch(/^quick-/)
        await waitFor(() => expect(fake!.order.length).toBe(2))
        await expect(fake!.order).toEqual([
            'mode:default',
            'send:synonym for quick?|instruction=on|mode=default',
        ])
        await expect(getChatInstruction(id)).toBe(QUICK_ASK_INSTRUCTION)
        await body.findByText('working')
        await expect(body.getByText('> synonym for quick?')).toBeInTheDocument()
        await expect(body.getByRole('button', { name: 'apply' })).toBeDisabled()

        fake!.token('**swift**')
        await body.findByText('swift')
        await expect(body.queryByText('working')).toBeNull()
        fake!.done()
        await waitFor(() => expect(body.getByRole('button', { name: 'apply' })).toBeEnabled())

        // Reply: same session; Enter while streaming would do nothing, so finish first.
        const replyInput = await body.findByPlaceholderText('reply…')
        await waitFor(() => expect(replyInput).toHaveFocus())
        await userEvent.type(replyInput, 'shorter{Enter}')
        await waitFor(() => expect(fake!.order.length).toBe(3))
        await expect(fake!.order[2]).toBe('send:shorter|instruction=on|mode=default')
        await expect(quickAskChatId()).toBe(id)
        fake!.token('swift')
        fake!.done()
        await waitFor(() => expect(body.getByRole('button', { name: 'apply' })).toBeEnabled())

        // Apply: acceptEdits first, then the apply message, shown as `> apply`. No text is inserted.
        await userEvent.click(body.getByRole('button', { name: 'apply' }))
        await waitFor(() => expect(fake!.order.length).toBe(5))
        await expect(fake!.order[3]).toBe('mode:acceptEdits')
        await expect(fake!.order[4]).toBe(
            `send:${applyMessage('notes/fox.md')}|instruction=on|mode=acceptEdits`,
        )
        await body.findByText('> apply')
        await expect(view!.state.doc.toString()).toBe(DOC)
        await expect(quickAskOpen()).not.toBeNull()

        // After the apply turn, the next reply drops the session back to default BEFORE sending.
        fake!.token('done')
        fake!.done()
        const again = await body.findByPlaceholderText('reply…')
        await waitFor(() => expect(again).toHaveFocus())
        // A synthetic Enter never clears the field (only a trusted one does), so clear by hand.
        await userEvent.clear(again)
        await userEvent.type(again, 'again{Enter}')
        await waitFor(() => expect(fake!.order.length).toBe(7))
        await expect(fake!.order[5]).toBe('mode:default')
        await expect(fake!.order[6]).toBe('send:again|instruction=on|mode=default')
    },
}

/** Esc closes through closeQuickAsk() and releases the chat id. */
export const EscCloses: Story = {
    name: 'esc closes',
    render: () => stage(),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await waitFor(() => expect(canvasElement.querySelector('[data-mounted]')).not.toBeNull())
        openQuickAsk({ kind: 'caret', view: view!, pos: DOC.length, notePath: null })
        await body.findByPlaceholderText('ask…')
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(quickAskOpen()).toBeNull())
        await expect(quickAskChatId()).toBeNull()
    },
}

/** open in chat: hands the id to the app and closes without disposing. */
export const OpenInChat: Story = {
    name: 'open in chat',
    render: () => stage(),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await waitFor(() => expect(canvasElement.querySelector('[data-mounted]')).not.toBeNull())
        openQuickAsk({ kind: 'caret', view: view!, pos: DOC.length, notePath: null })
        await body.findByPlaceholderText('ask…')
        const id = beginQuickAsk({ isTrusted: true })!
        setChatInstruction(id, QUICK_ASK_INSTRUCTION)
        fake!.ask('hello?')
        fake!.token('hi')
        fake!.done()
        await userEvent.click(await body.findByRole('button', { name: 'open in chat' }))
        await expect(onOpenChat).toHaveBeenCalledWith(id)
        // The chat tab behaves like any chat: the quick-ask instruction is gone.
        await expect(getChatInstruction(id)).toBeNull()
        await expect(quickAskOpen()).toBeNull()
        await expect(quickAskChatId()).toBeNull()
    },
}
