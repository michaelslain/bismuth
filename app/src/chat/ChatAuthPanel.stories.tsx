// Visual spec for <ChatAuthPanel> — the opencode providers popover body. Every story reaches its
// state through the fake transport's seed (ui/_fakeTransport.ts: `opencodeProviders`,
// `opencodeMode`) and, for the filter, a play() that types — no timers.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import ChatAuthPanel from './ChatAuthPanel'
import { setTransport } from '../api'
import {
    fakeTransport,
    sampleOpencodeProviders,
    type FakeTransportSeed,
} from '../ui/_fakeTransport'

const meta = {
    title: 'Chat/ChatAuthPanel',
    component: ChatAuthPanel,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatAuthPanel>

export default meta
type Story = StoryObj<typeof meta>

/** The panel hangs off an anchor (its own parent element) at the top-right of the story, the way it
 *  hangs off the credentials pill — so it opens downward and has room for a full list. */
const hosted =
    (seed: FakeTransportSeed): (() => JSX.Element) =>
    () => {
        setTransport(fakeTransport(seed))
        return (
            <div style={{ height: '700px' }}>
                <div
                    style={{
                        position: 'relative',
                        width: '320px',
                        height: '1px',
                        'margin-left': 'auto',
                        top: '8px',
                    }}
                >
                    <ChatAuthPanel onClose={() => {}} />
                </div>
            </div>
        )
    }

const sample = sampleOpencodeProviders()

export const Loading: Story = {
    render: hosted({ opencodeMode: 'loading' }),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('checking providers…'),
        ).not.toBeNull()
    },
}

export const NoneConnected: Story = {
    render: hosted({
        opencodeProviders: {
            connected: [],
            available: sample.available.slice(0, 6),
        },
    }),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(await c.findByText('no providers connected yet')).not.toBeNull()
        await expect(c.getByPlaceholderText('add a provider…')).not.toBeNull()
    },
}

export const SomeConnected: Story = {
    render: hosted({
        opencodeProviders: {
            connected: sample.connected,
            available: sample.available.slice(0, 5),
        },
    }),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(await c.findByText('anthropic')).not.toBeNull()
        await expect(c.getByText('opencode zen')).not.toBeNull()
        await expect(c.getByText('oauth')).not.toBeNull()
        await expect(c.getByText('api key')).not.toBeNull()
        // 4 API-key providers get `[ connect ]`, the one OAuth provider (github copilot) `[ sign in ]`
        await expect(c.getAllByRole('button', { name: 'connect' }).length).toBe(4)
        await expect(c.getAllByRole('button', { name: 'sign in' }).length).toBe(1)
    },
}

export const Filtering: Story = {
    render: hosted({}),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await c.findByText('anthropic')
        await userEvent.type(c.getByPlaceholderText('add a provider…'), 'GRO')
        await expect(c.getByText('groq')).not.toBeNull()
        await expect(c.queryByText('azure')).toBeNull()
        await expect(c.queryByText(/keep typing/)).toBeNull()
    },
}

export const TooMany: Story = {
    render: hosted({}),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await c.findByText('anthropic')
        await expect(c.getByText('+4 more // keep typing')).not.toBeNull()
        // 8 rows: the first by name is `azure`, the ninth (`mistral`) is cut
        await expect(c.getByText('azure')).not.toBeNull()
        await expect(c.queryByText('mistral')).toBeNull()
    },
}

export const NoMatch: Story = {
    render: hosted({}),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await c.findByText('anthropic')
        await userEvent.type(c.getByPlaceholderText('add a provider…'), 'zzz')
        await expect(c.getByText('no provider matches "zzz"')).not.toBeNull()
    },
}

export const OpencodeMissing: Story = {
    render: hosted({ opencodeMode: 'missing' }),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(await c.findByRole('alert')).not.toBeNull()
        await expect(c.getByText(/opencode is not installed/)).not.toBeNull()
        // the terminal path stays usable
        await expect(c.getByRole('button', { name: 'open terminal' })).not.toBeNull()
        await expect(c.getByRole('button', { name: 'copy command' })).not.toBeNull()
    },
}
