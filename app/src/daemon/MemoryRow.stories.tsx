// app/src/daemon/MemoryRow.stories.tsx
// Visual spec for <MemoryRow> — one memory row: name + type + age, then a one-line excerpt, with
// a trailing forget/confirm. DaemonMemory.tsx is the only importer. Fixtures are local `const`s,
// not ui/_daemonFixtures.ts (Task 1 owns that file).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import MemoryRow, { type MemoryRowProps } from './MemoryRow'
import type { MemoryListItem } from './DaemonMemory'
import styles from './MemoryRow.module.css'

const meta = {
    title: 'Daemon/MemoryRow',
    component: MemoryRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MemoryRow>

export default meta
type Story = StoryObj<typeof meta>

// MemoryRow reads the wall clock itself (memoryAge(item.updated, Date.now())), so its own age
// fixtures are built off the real Date.now() rather than a fixed instant — the assertions below
// tolerate the render happening a few ms after this module evaluates, well inside the rounding.
const HOUR = 60 * 60 * 1000
const iso = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString()

const ITEM: MemoryListItem = {
    path: '.daemon/memory/notes/ceramics-glaze.md',
    name: 'ceramics glaze notebook',
    type: 'note',
    updated: iso(4 * HOUR),
    excerpt:
        'Cone 6 reduction glazes tend toward warmer breaks at the rim — keep a log of each test tile.',
}

const LONG_ITEM: MemoryListItem = {
    ...ITEM,
    name: 'every conversation about the east studio kiln rebuild and its firing schedule migration plan',
    excerpt:
        'A very long excerpt that goes on well past one line of width so the ellipsis has to actually clip it rather than merely wrap onto a second visible line, which the row never renders.',
}

function Frame(props: { children: JSX.Element }) {
    return <div style={{ width: '380px' }}>{props.children}</div>
}

function noopRow(over: Partial<MemoryRowProps> = {}): MemoryRowProps {
    return {
        item: ITEM,
        confirming: false,
        onOpen: () => {},
        onForget: () => {},
        onConfirm: () => {},
        onCancel: () => {},
        ...over,
    }
}

export const Default: Story = {
    render: () => (
        <Frame>
            <MemoryRow {...noopRow()} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(ITEM.name)).toBeInTheDocument()
        await expect(canvas.getByText(ITEM.type)).toBeInTheDocument()
        await expect(canvas.getByText('4h ago')).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'forget' }),
        ).toBeInTheDocument()
    },
}

/** A name long enough that the head line must ellipsize the name, not the type/age it sits next
 *  to. */
export const LongName: Story = {
    render: () => (
        <Frame>
            <MemoryRow {...noopRow({ item: LONG_ITEM })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(ITEM.type)).toBeInTheDocument()
        await expect(canvas.getByText('4h ago')).toBeInTheDocument()
    },
}

/** The excerpt line is the long one this time — the head line stays intact while the excerpt
 *  clips. */
export const LongExcerpt: Story = {
    render: () => (
        <Frame>
            <MemoryRow
                {...noopRow({
                    item: { ...ITEM, excerpt: LONG_ITEM.excerpt },
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText(ITEM.name),
        ).toBeInTheDocument()
    },
}

/** First "forget" press is the PARENT's job (`onForget` only reports the press) — this story
 *  proves the row itself never flips its own confirm state. */
export const Confirming: Story = {
    render: () => (
        <Frame>
            <MemoryRow {...noopRow({ confirming: true })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByRole('button', { name: 'cancel' }),
        ).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'forget' }),
        ).toBeInTheDocument()
        // The cancel button is the safe default focus target while armed.
        await expect(canvas.getByRole('button', { name: 'cancel' })).toHaveFocus()
    },
}

let openedCount = 0

/** Keyboard reachability: the open button is a tab stop and Enter opens it; a press on the
 *  trailing forget button lives outside that button's subtree, so it must not also open the
 *  row. */
export const Focused: Story = {
    render: () => {
        openedCount = 0
        return (
            <Frame>
                <MemoryRow
                    {...noopRow({
                        onOpen: () => {
                            openedCount++
                        },
                    })}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const openBtn = canvasElement.querySelector<HTMLElement>(
            `.${styles['memory-row-open']}`,
        )!
        openBtn.focus()
        await expect(openBtn).toHaveFocus()
        await userEvent.keyboard('{Enter}')
        await expect(openedCount).toBe(1)

        const forgetBtn = within(canvasElement).getByRole('button', {
            name: 'forget',
        })
        forgetBtn.focus()
        await userEvent.keyboard('{Enter}')
        await expect(openedCount).toBe(1)
    },
}
