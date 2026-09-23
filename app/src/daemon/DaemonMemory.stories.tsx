// app/src/daemon/DaemonMemory.stories.tsx
// Visual spec for <DaemonMemory> — the search field + memory row list. DaemonPageHost.tsx is the
// only importer of the real component; this exercises it standalone with local fixtures (Task 1
// owns ui/_daemonFixtures.ts, not touched here).
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import DaemonMemory, { type MemoryListItem } from './DaemonMemory'

const meta = {
    title: 'Daemon/DaemonMemory',
    component: DaemonMemory,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonMemory>

export default meta
type Story = StoryObj<typeof meta>

// The real memory API returns a date-only `YYYY-MM-DD` (memory/src/dates.ts's todayISO()), a
// LOCAL calendar date rather than a UTC instant — fixtures match that shape so this story exercises
// the same path the app does.
const dateOnly = (daysAgo: number) => {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const ITEMS: MemoryListItem[] = [
    {
        path: '.daemon/memory/notes/ceramics-glaze.md',
        name: 'ceramics glaze notebook',
        type: 'note',
        updated: dateOnly(0),
        excerpt:
            'Cone 6 reduction glazes tend toward warmer breaks at the rim.',
    },
    {
        path: '.daemon/memory/facts/studio-hours.md',
        name: 'studio open hours',
        type: 'fact',
        updated: dateOnly(1),
        excerpt: 'East studio kiln room opens at 8am on firing days.',
    },
    {
        path: '.daemon/memory/people/mira.md',
        name: 'mira // glaze supplier contact',
        type: 'person',
        updated: dateOnly(3),
        excerpt: 'Prefers text over email; ships cone 6 test batches monthly.',
    },
]

function Frame(props: { children: import('solid-js').JSX.Element }) {
    return <div style={{ width: '360px', height: '420px' }}>{props.children}</div>
}

export const Default: Story = {
    render: () => (
        <Frame>
            <DaemonMemory
                items={ITEMS}
                query=""
                onQuery={() => {}}
                onOpen={() => {}}
                onForget={async () => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText(ITEMS[0].name),
        ).toBeInTheDocument()
        await expect(
            canvas.getByPlaceholderText('search memory'),
        ).toBeInTheDocument()
    },
}

/** Typing in the search field only reports the keystroke — the host debounces and re-fetches, so
 *  this story's `items` never changes on its own. */
export const Searching: Story = {
    render: () => {
        const [query, setQuery] = createSignal('')
        return (
            <Frame>
                <DaemonMemory
                    items={ITEMS}
                    query={query()}
                    onQuery={setQuery}
                    onOpen={() => {}}
                    onForget={async () => {}}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const input = within(canvasElement).getByPlaceholderText(
            'search memory',
        )
        await userEvent.type(input, 'mira')
        await expect(input).toHaveValue('mira')
    },
}

/** A query with a live `onQuery` wire but no `items` matching it — the host already narrowed the
 *  list down to zero before handing it back. */
export const NoMatch: Story = {
    render: () => (
        <Frame>
            <DaemonMemory
                items={[]}
                query="ceramics"
                onQuery={() => {}}
                onOpen={() => {}}
                onForget={async () => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('no memory matches "ceramics"'),
        ).toBeInTheDocument()
    },
}

export const Empty: Story = {
    render: () => (
        <Frame>
            <DaemonMemory
                items={[]}
                query=""
                onQuery={() => {}}
                onOpen={() => {}}
                onForget={async () => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('nothing remembered yet'),
        ).toBeInTheDocument()
    },
}

export const Loading: Story = {
    render: () => (
        <Frame>
            <DaemonMemory
                items={[]}
                query=""
                onQuery={() => {}}
                loading
                onOpen={() => {}}
                onForget={async () => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('Loading…'),
        ).toBeInTheDocument()
    },
}

/** Pressing a row's "forget" arms that row's inline confirm — `onForget` (the actual delete) is
 *  not called until the second press. */
export const ConfirmingForget: Story = {
    render: () => (
        <Frame>
            <DaemonMemory
                items={ITEMS}
                query=""
                onQuery={() => {}}
                onOpen={() => {}}
                onForget={async () => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const forgetButtons = canvas.getAllByRole('button', {
            name: 'forget',
        })
        await userEvent.click(forgetButtons[0])
        await expect(
            canvas.getByRole('button', { name: 'cancel' }),
        ).toBeInTheDocument()
    },
}
