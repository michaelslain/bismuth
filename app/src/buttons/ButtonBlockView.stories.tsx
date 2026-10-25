// Visual + behaviour spec for <ButtonBlockView> — the live block. A fake runtime stands in for the
// real one; its states come from a story-controlled signal (`ctl`), never a timer.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import type {
    ButtonBlock,
    ButtonHost,
    ButtonState,
} from '../../../core/src/buttons/buttonTypes'
import ButtonBlockView from './ButtonBlockView'
import { trustKey } from './buttonRowLogic'
import { setButtonRuntime, type ButtonRuntime } from './buttonRuntime'

const PROMPT = 'Summarize what changed in this note this week.'
const BODY = JSON.stringify({
    error: null,
    buttons: [
        { label: 'Summarize', kind: 'primary', action: { type: 'prompt', prompt: PROMPT, model: 'haiku', timeoutSecs: 300 } },
        { label: 'Ask', kind: 'default', action: { type: 'send', text: 'What is open here?' } },
    ],
} satisfies ButtonBlock)

const note: ButtonHost = { kind: 'note', path: 'week.md' }
const chat: ButtonHost = { kind: 'chat', chatId: 'c1' }

const [store, setStore] = createSignal<Record<string, ButtonState>>({})
const trusted = new Set<string>()
const ctl = {
    press: fn(),
    runCommand: fn(),
    set: (key: string, s: ButtonState | null) =>
        setStore(prev => {
            const next = { ...prev }
            if (s) next[key] = s
            else delete next[key]
            return next
        }),
}

const mkState = (status: ButtonState['status'], note: string | null): ButtonState => ({
    status,
    host: 'note:week.md',
    label: 'summarize',
    prompt: PROMPT,
    model: 'haiku',
    timeoutSecs: 300,
    pressedAt: new Date().toISOString(),
    completedAt: status === 'working' ? null : new Date().toISOString(),
    note,
})

const runtime: ButtonRuntime = {
    parse: body => JSON.parse(body),
    key: (_h, _b, i) => `k${i}`,
    press: async req => {
        ctl.press(req)
        const state = mkState('working', null)
        ctl.set('k0', state)
        return { ok: true, key: 'k0', state }
    },
    states: async keys => Object.fromEntries(keys.filter(k => store()[k]).map(k => [k, store()[k]])),
    runCommand: async id => void ctl.runCommand(id),
    commandLabel: () => undefined,
    daemonEnabled: () => true,
    notOwner: () => false,
    isTrusted: t => trusted.has(t),
    trust: t => void trusted.add(t),
}

const meta = {
    title: 'App/Buttons/ButtonBlockView',
    component: ButtonBlockView,
    parameters: { layout: 'fullscreen' },
    beforeEach: () => {
        setStore({})
        trusted.clear()
        ctl.press.mockClear()
        setButtonRuntime(runtime)
    },
    render: args => (
        <div style={{ width: 'min(760px, 100%)', padding: '16px' }}>
            <ButtonBlockView {...args} />
        </div>
    ),
} satisfies Meta<typeof ButtonBlockView>

export default meta
type Story = StoryObj<typeof meta>

/** A chat button never asks: press goes straight to working, then the daemon finishes. */
export const PressWorkingDone: Story = {
    args: { host: chat, body: BODY },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(await c.findByRole('button', { name: /summarize/ }))
        await waitFor(() => expect(canvasElement.textContent).toContain('working…'))
        await expect((await c.findByRole('button', { name: /summarize/ })).hasAttribute('disabled')).toBe(true)
        ctl.set('k0', mkState('done', 'Added the summary.'))
        await waitFor(() => expect(canvasElement.textContent).toContain('done // Added the summary.'), {
            timeout: 5000,
        })
    },
}

/** An untrusted note prompt asks first; [run] remembers the text and presses. */
export const UntrustedPromptConfirm: Story = {
    args: { host: note, body: BODY },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(await c.findByRole('button', { name: /summarize/ }))
        await expect(canvasElement.textContent).toContain(`run this? ${PROMPT}`)
        await expect(ctl.press).not.toHaveBeenCalled()
        await userEvent.click(await c.findByRole('button', { name: /^run$|\brun\b/ }))
        await waitFor(() => expect(ctl.press).toHaveBeenCalledTimes(1))
        await expect(trusted.has(trustKey({ type: 'prompt', prompt: PROMPT, model: 'haiku', timeoutSecs: 300 }))).toBe(true)
    },
}

/** [cancel] and Escape both restore the row without pressing. */
export const CancelRestores: Story = {
    args: { host: note, body: BODY },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(await c.findByRole('button', { name: /summarize/ }))
        await userEvent.click(await c.findByRole('button', { name: /cancel/ }))
        await expect(canvasElement.textContent).not.toContain('run this?')
        await userEvent.click(await c.findByRole('button', { name: /summarize/ }))
        await expect(canvasElement.textContent).toContain('run this?')
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(canvasElement.textContent).not.toContain('run this?'))
        await expect(ctl.press).not.toHaveBeenCalled()
    },
}

/** A note send asks first, then hands the text to onSend. */
export const NoteSendConfirm: Story = {
    args: { host: note, body: BODY, onSend: fn() },
    play: async ({ canvasElement, args }) => {
        const c = within(canvasElement)
        await userEvent.click(await c.findByRole('button', { name: /^ask$|\bask\b/ }))
        await expect(canvasElement.textContent).toContain('send this? What is open here?')
        await userEvent.click(await c.findByRole('button', { name: /^send$|\bsend\b/ }))
        await expect(args.onSend).toHaveBeenCalledWith('What is open here?')
    },
}

/** A chat send goes straight to onSend, no confirm. */
export const ChatSend: Story = {
    args: { host: chat, body: BODY, onSend: fn() },
    play: async ({ canvasElement, args }) => {
        await userEvent.click(await within(canvasElement).findByRole('button', { name: /\bask\b/ }))
        await expect(args.onSend).toHaveBeenCalledWith('What is open here?')
    },
}

/** A rejected press (network down) shows as a failed line with the message. */
export const PressRejects: Story = {
    args: { host: chat, body: BODY },
    beforeEach: () => {
        setButtonRuntime({
            ...runtime,
            press: async () => {
                throw new Error('network down')
            },
        })
    },
    play: async ({ canvasElement }) => {
        await userEvent.click(await within(canvasElement).findByRole('button', { name: /summarize/ }))
        await waitFor(() => expect(canvasElement.textContent).toContain('failed // network down'))
    },
}
