// app/src/daemon/InboxRow.stories.tsx
// Visual spec for <InboxRow> — one inbox row: status dot, title/source/time, a one-line snippet,
// and (when due) inline actions. DaemonInbox.tsx is the only importer. Covers every PageStatus
// the fixture set carries (sampleDaemonPages(), ui/_daemonFixtures.ts) plus the keyboard path a
// bare-element pass added: the row can't become a real <button> (it nests real action buttons
// when due, and a button can't contain another button), so it's role="button" + tabindex + its
// own onKeyDown instead — KeyboardOpen proves Enter opens it and that a press on a nested action
// button does NOT also open it (the actions wrapper stops that bubble, mirroring the click
// stopPropagation it already had).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, fireEvent, within } from 'storybook/test'
import InboxRow from './InboxRow'
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

/** Due, with its actions live — the APPROVE/DISMISS pair renders and is pressable. */
export const Pending: Story = {
    render: () => (
        <Frame>
            <InboxRow
                page={pending}
                onOpen={noop}
                showActions
                onChanged={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(pending.title)).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'SUBMIT' }),
        ).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'DISMISS' }),
        ).toBeInTheDocument()
    },
}

/** Mid-run — its actions render but are disabled while the daemon works the page. */
export const Working: Story = {
    render: () => (
        <Frame>
            <InboxRow
                page={working}
                onOpen={noop}
                showActions
                onChanged={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByRole('button', { name: 'RUN NOW' }),
        ).toBeDisabled()
    },
}

/** Resolved, terminal — DaemonInbox.tsx always passes `showActions={false}` for "Recently
 *  resolved" rows, so no action buttons ever render here. */
export const Done: Story = {
    render: () => (
        <Frame>
            <InboxRow
                page={done}
                onOpen={noop}
                showActions={false}
                onChanged={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(done.title)).toBeInTheDocument()
        await expect(canvasElement.querySelector('button')).toBeNull()
    },
}

export const Failed: Story = {
    render: () => (
        <Frame>
            <InboxRow
                page={failed}
                onOpen={noop}
                showActions={false}
                onChanged={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText(failed.title),
        ).toBeInTheDocument()
    },
}

export const Dismissed: Story = {
    render: () => (
        <Frame>
            <InboxRow
                page={dismissed}
                onOpen={noop}
                showActions={false}
                onChanged={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText(dismissed.title),
        ).toBeInTheDocument()
    },
}

let openedCount = 0

/** Keyboard reachability: the row itself is a tab stop (role="button" + tabindex=0) and Enter
 *  opens it, same as a click. A press on a nested action button must NOT also open the row —
 *  proving the keydown-stopPropagation fix on `.inbox-row-actions` actually works, not just the
 *  pre-existing click one. */
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
                    showActions
                    onChanged={noop}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>(
            '[role="button"]',
        )!
        await expect(row).not.toBeNull()
        row.focus()
        await fireEvent.keyDown(row, { key: 'Enter' })
        await expect(openedCount).toBe(1)

        const actionBtn = within(canvasElement).getByRole('button', {
            name: 'SUBMIT',
        })
        actionBtn.focus()
        await fireEvent.keyDown(actionBtn, { key: 'Enter' })
        await expect(openedCount).toBe(1)
    },
}
