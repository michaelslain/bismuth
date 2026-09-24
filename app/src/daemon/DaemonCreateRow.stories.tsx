// Visual spec for <DaemonCreateRow> — the `+ new …` last row of a daemon list. Rendered under two
// real DaemonRows inside a list-shaped grid (the same template DaemonProcesses uses), because the
// whole point of the row is that its `+` and words line up with the dot and name columns above.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import DaemonCreateRow from './DaemonCreateRow'
import DaemonRow from './DaemonRow'

const meta = {
    title: 'Daemon/DaemonCreateRow',
    component: DaemonCreateRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonCreateRow>

export default meta
type Story = StoryObj<typeof meta>

const LIST_STYLE = {
    display: 'grid',
    'grid-template-columns': 'auto minmax(12ch, max-content) minmax(max-content, 1fr)',
    width: '360px',
}

const List = (props: { onCreate: (name: string) => Promise<void> }) => (
    <div style={LIST_STYLE}>
        <DaemonRow name="web-search" tone="running" status="on" onOpen={() => {}} />
        <DaemonRow name="backup-watcher" tone="off" status="off" dim onOpen={() => {}} />
        <DaemonCreateRow label="new service" onCreate={props.onCreate} />
    </div>
)

/** At rest: `+ new service` under the rows, `+` in the dot column, words in the name column. */
export const Resting: Story = {
    args: { label: 'new service', onCreate: fn(async () => {}) },
    render: args => <List onCreate={args.onCreate} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const button = canvas.getByRole('button', { name: 'new service' })
        await expect(getComputedStyle(button).opacity).toBe('1')
        // The words start where the names start, and the `+` sits in the dot column.
        const name = canvas.getByText('web-search')
        const words = canvas.getByText('new service')
        await expect(
            Math.abs(words.getBoundingClientRect().left - name.getBoundingClientRect().left),
        ).toBeLessThanOrEqual(1)
        const row = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-row"]')!
        const createRow = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-create-row"]',
        )!
        const dot = row.firstElementChild as HTMLElement
        const plus = createRow.firstElementChild as HTMLElement
        const centre = (r: DOMRect) => r.left + r.width / 2
        await expect(
            Math.abs(centre(plus.getBoundingClientRect()) - centre(dot.getBoundingClientRect())),
        ).toBeLessThanOrEqual(1)
        // Same row height as the rows above, so the list's rhythm holds.
        await expect(createRow.getBoundingClientRect().height).toBe(
            row.getBoundingClientRect().height,
        )
    },
}

/** Clicked: the words become the name field in place; Enter creates, the row returns. */
export const Creating: Story = {
    args: { label: 'new service', onCreate: fn(async () => {}) },
    render: args => <List onCreate={args.onCreate} />,
    play: async ({ args, canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: 'new service' }))
        const field = canvas.getByRole('textbox', { name: 'new service name' })
        const name = canvas.getByText('web-search')
        await expect(
            Math.abs(field.getBoundingClientRect().left - name.getBoundingClientRect().left),
        ).toBeLessThanOrEqual(1)
        await userEvent.type(field, 'sync-worker{Enter}')
        await expect(args.onCreate).toHaveBeenCalledWith('sync-worker')
        await expect(
            canvas.getByRole('button', { name: 'new service' }),
        ).toBeInTheDocument()
    },
}

/** A rejected create keeps the field open, its message trailing it; Esc still cancels. */
export const CreateError: Story = {
    args: {
        label: 'new service',
        onCreate: fn(async () => {
            throw new Error('a service named "sync-worker" already exists')
        }),
    },
    render: args => <List onCreate={args.onCreate} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: 'new service' }))
        await userEvent.type(
            canvas.getByRole('textbox', { name: 'new service name' }),
            'sync-worker{Enter}',
        )
        await expect(
            canvas.getByText('a service named "sync-worker" already exists'),
        ).toBeInTheDocument()
        await userEvent.keyboard('{Escape}')
        await expect(
            canvas.getByRole('button', { name: 'new service' }),
        ).toBeInTheDocument()
    },
}
