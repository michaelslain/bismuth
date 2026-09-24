// app/src/daemon/InboxRow.stories.tsx
// Visual spec for <InboxRow> — one inbox row, one line: status dot + title + time. Covers every
// PageStatus the fixture set carries (sampleDaemonPages(), ui/_daemonFixtures.ts) plus the
// keyboard path: a real <button> (PlainButton) wraps only the dot + main text, since a button
// can never contain another button and archive renders a real one; KeyboardOpen proves Enter on
// that button opens the row and that a press on the archive button does NOT also open it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import InboxRow from './InboxRow'
import styles from './InboxRow.module.css'
import { sampleDaemonPages } from '../ui/_daemonFixtures'

const meta = {
    title: 'Daemon/InboxRow',
    component: InboxRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof InboxRow>

export default meta
type Story = StoryObj<typeof meta>

const [pending, working, done, failed, dismissed] = sampleDaemonPages()
const noop = () => {}

function Frame(props: { children: JSX.Element }) {
    return <div style={{ width: '360px' }}>{props.children}</div>
}

/** Due — one line, no source/snippet text, `[archive]` hidden at rest and revealed on hover or
 *  focus-within. */
export const Pending: Story = {
    render: () => (
        <Frame>
            <InboxRow page={pending} onOpen={noop} onChanged={noop} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(pending.title)).toBeInTheDocument()
        await expect(canvas.queryByText(pending.source!)).toBeNull()
        const archiveBtn = canvas.getByRole('button', { name: 'archive' })
        await expect(archiveBtn).toBeInTheDocument()
        // Overlaid on the row's line, hidden and out of the flow at rest — until the row is
        // hovered or a control inside it is focused.
        const actionsBox = canvasElement.querySelector<HTMLElement>(
            `.${styles['inbox-row-actions']}`,
        )!
        await expect(getComputedStyle(actionsBox).opacity).toBe('0')
        archiveBtn.focus()
        await waitFor(() => expect(getComputedStyle(actionsBox).opacity).toBe('1'))
    },
}

/** Mid-run — no archive button at all (the server refuses archiving a working page). */
export const Working: Story = {
    render: () => (
        <Frame>
            <InboxRow page={working} onOpen={noop} onChanged={noop} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(working.title)).toBeInTheDocument()
        await expect(canvas.queryByRole('button', { name: 'archive' })).toBeNull()
    },
}

/** Resolved, terminal — still gets an archive button, hidden at rest same as any other row. */
export const Done: Story = {
    render: () => (
        <Frame>
            <InboxRow page={done} onOpen={noop} onChanged={noop} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(done.title)).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: 'archive' })).toBeInTheDocument()
    },
}

/** Failed — one line still, no failure-note text; archive stays the only action. */
export const Failed: Story = {
    render: () => (
        <Frame>
            <InboxRow page={failed} onOpen={noop} onChanged={noop} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(failed.title)).toBeInTheDocument()
        await expect(canvas.queryByText(failed.daemonNote!)).toBeNull()
        await expect(canvas.queryByRole('button', { name: /retry/ })).toBeNull()
        await expect(canvas.getByRole('button', { name: 'archive' })).toBeInTheDocument()
    },
}

export const Dismissed: Story = {
    render: () => (
        <Frame>
            <InboxRow page={dismissed} onOpen={noop} onChanged={noop} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText(dismissed.title),
        ).toBeInTheDocument()
    },
}

let openedCount = 0

/** Keyboard reachability: the open button (`.inbox-row-open`, a real <button>) is a tab stop
 *  and Enter opens it, same as a click. A press on the archive button must NOT also open the
 *  row — it lives outside the open button's subtree entirely, so there's nothing to bubble
 *  into, and archive itself stops propagation on both click and pointerdown. */
export const KeyboardOpen: Story = {
    render: () => {
        openedCount = 0
        return (
            <Frame>
                <InboxRow
                    page={pending}
                    onOpen={() => {
                        openedCount++
                    }}
                    onChanged={noop}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const openBtn = canvasElement.querySelector<HTMLElement>(
            `.${styles['inbox-row-open']}`,
        )!
        await expect(openBtn).not.toBeNull()
        // A real <button> has no keydown handler of its own — Enter-activates it via the
        // platform's default action, which only userEvent (not a raw fireEvent.keyDown) simulates.
        openBtn.focus()
        await userEvent.keyboard('{Enter}')
        await expect(openedCount).toBe(1)

        const archiveBtn = within(canvasElement).getByRole('button', {
            name: 'archive',
        })
        await userEvent.click(archiveBtn)
        await expect(openedCount).toBe(1)
    },
}
