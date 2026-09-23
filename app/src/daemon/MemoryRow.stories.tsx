// app/src/daemon/MemoryRow.stories.tsx
// Visual spec for <MemoryRow> — one memory row: name + type + age, then a one-line excerpt, with
// a trailing forget/confirm. DaemonMemory.tsx is the only importer. Fixtures are local `const`s,
// not ui/_daemonFixtures.ts (Task 1 owns that file).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import MemoryRow, { type MemoryRowProps } from './MemoryRow'
import type { MemoryListItem } from './DaemonMemory'

const meta = {
    title: 'Daemon/MemoryRow',
    component: MemoryRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MemoryRow>

export default meta
type Story = StoryObj<typeof meta>

// MemoryRow reads the wall clock itself (memoryAge(item.updated, Date.now())). The real memory
// API returns a date-only `YYYY-MM-DD` (memory/src/dates.ts's todayISO()), a LOCAL calendar date
// rather than a UTC instant, so the fixture matches that shape rather than a full ISO timestamp.
const dateOnly = (daysAgo: number) => {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const ITEM: MemoryListItem = {
    path: '.daemon/memory/notes/ceramics-glaze.md',
    name: 'ceramics glaze notebook',
    type: 'note',
    updated: dateOnly(0),
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
        await expect(canvas.getByText('today')).toBeInTheDocument()
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
        await expect(canvas.getByText('today')).toBeInTheDocument()
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
        const openBtn = within(canvasElement).getByRole('button', {
            name: `${ITEM.name}, ${ITEM.type}`,
        })
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
