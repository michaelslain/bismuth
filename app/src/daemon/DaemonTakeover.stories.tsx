// app/src/daemon/DaemonTakeover.stories.tsx
// Visual spec for <DaemonTakeover> — the opened-section frame. Rows are plain `Text` stand-ins;
// the real lists are proven in their own stories.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import { createSignal, For, Show, type JSX } from 'solid-js'
import { ContextMenu } from '../ui/ContextMenu'
import DaemonTakeover from './DaemonTakeover'
import Text from '../ui/Text'

const meta = {
    title: 'Daemon/DaemonTakeover',
    component: DaemonTakeover,
    parameters: { layout: 'fullscreen' },
    args: { onClose: fn() },
} satisfies Meta<typeof DaemonTakeover>

export default meta
type Story = StoryObj<typeof meta>

function Frame(props: { children: JSX.Element }) {
    return (
        <div style={{ width: '1300px', height: '700px', 'max-width': '100%', padding: 'var(--sp-4)', 'box-sizing': 'border-box' }}>
            {props.children}
        </div>
    )
}

function Rows(props: { n: number }) {
    return (
        <For each={Array.from({ length: props.n }, (_, i) => i + 1)}>
            {i => (
                <Text as="div" size="ui">
                    stub row {i} // every hour // ok
                </Text>
            )}
        </For>
    )
}

export const Default: Story = {
    render: args => (
        <Frame>
            <DaemonTakeover {...args} title="crons" count={12}>
                <Rows n={12} />
            </DaemonTakeover>
        </Frame>
    ),
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('crons')).toBeInTheDocument()
        await expect(canvas.getByText('12')).toBeInTheDocument()
        await userEvent.click(canvas.getByTestId('daemon-takeover-close'))
        await expect(args.onClose).toHaveBeenCalledTimes(1)
    },
}

export const Long: Story = {
    render: args => (
        <Frame>
            <DaemonTakeover {...args} title="log" count={60}>
                <Rows n={60} />
            </DaemonTakeover>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const root = canvasElement.querySelector('[data-testid="daemon-takeover"]') as HTMLElement
        const body = root.lastElementChild as HTMLElement
        await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
        await expect(root.getBoundingClientRect().height).toBeLessThanOrEqual(700)
    },
}

export const NoCount: Story = {
    render: args => (
        <Frame>
            <DaemonTakeover {...args} title="log">
                <Rows n={5} />
            </DaemonTakeover>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('log')).toBeInTheDocument()
    },
}

function MenuBody(props: { onClose: () => void }) {
    // Closed at mount: the menu must open AFTER the takeover's own listener is registered, as it
    // does in the app — a menu mounted with the takeover would mask the listener-order bug.
    const [open, setOpen] = createSignal(false)
    return (
        <>
            <Text as="div" size="ui" onContextMenu={(e: MouseEvent) => { e.preventDefault(); setOpen(true) }}>
                right-click me
            </Text>
            <Show when={open()}>
                <ContextMenu
                    x={200}
                    y={200}
                    items={[{ label: 'Delete', onSelect: () => {} }]}
                    onClose={() => {
                        setOpen(false)
                        props.onClose()
                    }}
                />
            </Show>
        </>
    )
}

// Esc with a context menu open closes ONLY the menu; the next Esc closes the takeover.
export const EscapeWithMenu: Story = {
    render: args => (
        <Frame>
            <DaemonTakeover {...args} title="crons" count={3}>
                <MenuBody onClose={() => {}} />
            </DaemonTakeover>
        </Frame>
    ),
    play: async ({ canvasElement, args }) => {
        const body = within(document.body)
        await userEvent.pointer({ keys: '[MouseRight]', target: within(canvasElement).getByText('right-click me') })
        await waitFor(() => body.getByText('Delete'))
        const esc = () =>
            (document.activeElement ?? document.body).dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
            )
        esc()
        await waitFor(() => expect(body.queryByText('Delete')).toBeNull())
        await expect(args.onClose).not.toHaveBeenCalled()
        esc()
        await expect(args.onClose).toHaveBeenCalledTimes(1)
    },
}
