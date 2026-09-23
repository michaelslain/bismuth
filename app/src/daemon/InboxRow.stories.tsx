// app/src/daemon/InboxRow.stories.tsx
// Visual spec for <InboxRow> — one inbox row: status dot + title + time, then source // snippet
// (or the failure note), and (when due or failed) inline actions. DaemonInbox.tsx is the only importer. Covers every PageStatus
// the fixture set carries (sampleDaemonPages(), ui/_daemonFixtures.ts) plus the keyboard path: a
// real <button> (PlainButton) wraps only the dot + main text, since a button can never contain
// another button and the actions render real ones when due — KeyboardOpen proves Enter on that
// button opens the row and that a press on a nested action button does NOT also open it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
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
            canvas.getByRole('button', { name: 'submit' }),
        ).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'dismiss' }),
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
            canvas.getByRole('button', { name: 'run now' }),
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
        // Open button always renders (dot + main); only the actions wrapper is conditional.
        await expect(
            canvasElement.querySelector(`.${styles['inbox-row-actions']}`),
        ).toBeNull()
    },
}

/** Failed keeps its actions live (pressing again re-runs the round-trip): the action that failed
 *  reads RETRY, and the daemon's failure note replaces the snippet, in the danger tone. */
export const Failed: Story = {
    render: () => (
        <Frame>
            <InboxRow
                page={failed}
                onOpen={noop}
                showActions
                onChanged={noop}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(failed.title)).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: /retry/ }),
        ).toBeInTheDocument()
        await expect(
            canvas.getByText(failed.daemonNote!),
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

/** Keyboard reachability: the open button (`.inbox-row-open`, a real <button>) is a tab stop and
 *  Enter opens it, same as a click. A press on a nested action button must NOT also open the row
 *  — it lives outside the open button's subtree entirely, so there's nothing to bubble into. */
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
        const openBtn = canvasElement.querySelector<HTMLElement>(
            `.${styles['inbox-row-open']}`,
        )!
        await expect(openBtn).not.toBeNull()
        // A real <button> has no keydown handler of its own — Enter-activates it via the
        // platform's default action, which only userEvent (not a raw fireEvent.keyDown) simulates.
        openBtn.focus()
        await userEvent.keyboard('{Enter}')
        await expect(openedCount).toBe(1)

        const actionBtn = within(canvasElement).getByRole('button', {
            name: 'submit',
        })
        actionBtn.focus()
        await userEvent.keyboard('{Enter}')
        await expect(openedCount).toBe(1)
    },
}
