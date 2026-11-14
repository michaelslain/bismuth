// Visual spec for <OpencodeLocalServerRow> — the provider manager's connect-a-server row. The `add`
// prop is the seam: each story hands it a function that answers a fixed outcome, or one that
// resolves on demand (`connecting`). `remove asks` hosts the manager, because the `[x]` lives on the
// manager's saved local row.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import OpencodeLocalServerRow from './OpencodeLocalServerRow'
import OpencodeProviderManager from './OpencodeProviderManager'
import { setTransport, type OpencodeAddServerResult } from '../api'
import {
    fakeTransport,
    sampleOpencodeLocal,
    sampleOpencodeProviders,
} from '../ui/_fakeTransport'

const meta = {
    title: 'Chat/OpencodeLocalServerRow',
    component: OpencodeLocalServerRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof OpencodeLocalServerRow>

export default meta
type Story = StoryObj<typeof meta>

const boxed = (body: () => JSX.Element) => () => (
    <div class="bismuth-popover" style={{ width: '360px' }}>
        {body()}
    </div>
)

const saved = (models: number): OpencodeAddServerResult => ({
    outcome: 'saved',
    server: {
        id: 'local-ollama',
        name: 'ollama',
        url: '192.168.1.20:11434',
        models,
        source: 'saved',
    },
    list: { connected: [], available: [] },
})

const answering = (res: OpencodeAddServerResult) => () => Promise.resolve(res)

const typeUrl = async (c: ReturnType<typeof within>, url: string) =>
    userEvent.type(c.getByPlaceholderText(/server url/), url)

export const Empty: Story = {
    args: { onSaved: () => {} },
    render: args => boxed(() => <OpencodeLocalServerRow {...args} />)(),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const connect = c.getByRole('button', { name: 'connect' })
        await expect((connect as HTMLButtonElement).disabled).toBe(true)
        await expect(c.getByPlaceholderText('key (optional)')).not.toBeNull()
    },
}

/** An `add` that is still out: the button reads `connecting`, disabled, and the inputs are read-only. */
export const Connecting: Story = {
    args: { onSaved: () => {} },
    render: args =>
        boxed(() => (
            <OpencodeLocalServerRow
                {...args}
                add={() => new Promise<OpencodeAddServerResult>(() => {})}
            />
        ))(),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await typeUrl(c, 'http://192.168.1.20:1234')
        await userEvent.click(c.getByRole('button', { name: 'connect' }))
        const b = await c.findByRole('button', { name: 'connecting' })
        await expect((b as HTMLButtonElement).disabled).toBe(true)
        await expect((c.getByPlaceholderText(/server url/) as HTMLInputElement).readOnly).toBe(true)
        await expect((c.getByPlaceholderText('key (optional)') as HTMLInputElement).readOnly).toBe(true)
    },
}

export const Found: Story = {
    args: { onSaved: () => {} },
    render: args =>
        boxed(() => <OpencodeLocalServerRow {...args} add={answering(saved(4))} />)(),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await typeUrl(c, 'http://192.168.1.20:11434')
        await userEvent.click(c.getByRole('button', { name: 'connect' }))
        await expect(await c.findByText('found 4 models // saved')).not.toBeNull()
        await expect((c.getByPlaceholderText(/server url/) as HTMLInputElement).value).toBe('')
    },
}

export const NothingAnswered: Story = {
    args: { onSaved: () => {} },
    render: args =>
        boxed(() => (
            <OpencodeLocalServerRow
                {...args}
                add={answering({ outcome: 'nothing', url: 'http://192.168.1.20:1234' })}
            />
        ))(),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await typeUrl(c, 'http://192.168.1.20:1234')
        await userEvent.click(c.getByRole('button', { name: 'connect' }))
        await expect(await c.findByText('nothing answered at http://192.168.1.20:1234')).not.toBeNull()
    },
}

export const Existing: Story = {
    args: { onSaved: () => {} },
    render: args =>
        boxed(() => (
            <OpencodeLocalServerRow
                {...args}
                add={answering({ outcome: 'existing', name: 'LM Studio' })}
            />
        ))(),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await typeUrl(c, 'http://127.0.0.1:1234')
        await userEvent.click(c.getByRole('button', { name: 'connect' }))
        await expect(await c.findByText('already connected as lm studio')).not.toBeNull()
    },
}

/** A saved server's `[x]` pressed: the row itself asks `[remove] [cancel]`. */
export const RemoveAsks: Story = {
    args: { onSaved: () => {} },
    render: () => {
        setTransport(
            fakeTransport({
                opencodeProviders: {
                    ...sampleOpencodeProviders(),
                    ...sampleOpencodeLocal(),
                },
            }),
        )
        return (
            <div class="bismuth-popover" style={{ width: '360px' }}>
                <OpencodeProviderManager />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(await c.findByRole('button', { name: /^remove server/ }))
        await expect(c.getByText(/remove lm studio/)).not.toBeNull()
        await expect(c.getByRole('button', { name: 'remove' })).not.toBeNull()
        await expect(c.getByRole('button', { name: 'cancel' })).not.toBeNull()
    },
}
