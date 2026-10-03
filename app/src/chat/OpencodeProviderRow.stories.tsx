// Visual spec for <OpencodeProviderRow> — one unconnected opencode provider and its in-place
// connect / sign-in states. The states that need a real sign-in tab or a pending request start from
// `initialState` (no timers, no window.open); the rest are reached by clicking through the fake
// transport (ui/_fakeTransport.ts), whose key `bad…` is the rejected one.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import OpencodeProviderRow from './OpencodeProviderRow'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'

const apiProvider = {
    id: 'groq',
    name: 'groq',
    methods: [{ type: 'api' as const, label: 'API key' }],
}
const oauthProvider = {
    id: 'openrouter',
    name: 'openrouter',
    methods: [{ type: 'oauth' as const, label: 'Paste the code' }],
}

const meta = {
    title: 'Chat/OpencodeProviderRow',
    component: OpencodeProviderRow,
    parameters: { layout: 'padded' },
    render: args => {
        setTransport(fakeTransport())
        return (
            <div class="bismuth-popover" style={{ width: '300px' }}>
                <OpencodeProviderRow {...args} />
            </div>
        )
    },
    args: { provider: apiProvider, onConnected: () => {} },
} satisfies Meta<typeof OpencodeProviderRow>

export default meta
type Story = StoryObj<typeof meta>

export const IdleApiKey: Story = {
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('groq')).not.toBeNull()
        await expect(c.getByRole('button', { name: 'connect' })).not.toBeNull()
    },
}

export const IdleOauth: Story = {
    args: { provider: oauthProvider },
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByRole('button', { name: 'sign in' }),
        ).not.toBeNull()
    },
}

export const KeyEntry: Story = {
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'connect' }))
        const input = c.getByPlaceholderText('groq API key') as HTMLInputElement
        await expect(input.type).toBe('password')
        await expect(c.getByRole('button', { name: 'save' })).not.toBeNull()
        await expect(c.getByRole('button', { name: 'cancel' })).not.toBeNull()
    },
}

export const Connecting: Story = {
    args: { initialState: { kind: 'connecting' } },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('connecting…')).not.toBeNull()
    },
}

export const KeyRejected: Story = {
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'connect' }))
        await userEvent.type(c.getByPlaceholderText('groq API key'), 'bad-key')
        await userEvent.click(c.getByRole('button', { name: 'save' }))
        await waitFor(() =>
            expect(c.getByRole('alert').textContent).toBe('opencode rejected that key'),
        )
        // back in key entry, key kept out of the message, ready to retry
        await expect(c.getByPlaceholderText('groq API key')).not.toBeNull()
    },
}

let connectedName: string | undefined

export const KeyAccepted: Story = {
    render: args => {
        setTransport(fakeTransport())
        connectedName = undefined
        return (
            <div class="bismuth-popover" style={{ width: '300px' }}>
                <OpencodeProviderRow
                    {...args}
                    onConnected={name => {
                        connectedName = name
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'connect' }))
        await userEvent.type(c.getByPlaceholderText('groq API key'), 'sk-good')
        await userEvent.click(c.getByRole('button', { name: 'save' }))
        await waitFor(() => expect(connectedName).toBe('groq'))
    },
}

export const OauthCodeEntry: Story = {
    args: {
        provider: oauthProvider,
        initialState: {
            kind: 'code',
            method: 0,
            instructions: 'Sign in, then paste the code shown on the final page.',
        },
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByPlaceholderText('paste the code')).not.toBeNull()
        await expect(c.getByRole('button', { name: 'submit' })).not.toBeNull()
    },
}

export const OauthWaiting: Story = {
    args: {
        provider: oauthProvider,
        initialState: {
            kind: 'waiting',
            instructions: 'Finish signing in in your browser.',
        },
    },
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('waiting for sign-in…'),
        ).not.toBeNull()
    },
}

export const OauthFailed: Story = {
    args: {
        provider: oauthProvider,
        initialError: 'sign-in was cancelled before it finished',
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByRole('alert').textContent).toContain('cancelled')
        await expect(c.getByRole('button', { name: 'sign in' })).not.toBeNull()
    },
}
