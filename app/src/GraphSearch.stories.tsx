// Visual spec for <GraphSearch> — the graph-scoped search overlay (SearchBar over a
// keyboard-navigable, substring-filtered node list). `query` is an UNCONTROLLED internal
// signal with no prop to seed it, and the results list is hard-gated on a non-empty query
// (`<Show when={query().trim()}>` — see GraphSearch.tsx) — a story that only ever passes
// `items` would show nothing but the bare search bar, which is real behavior but shows none
// of the component. `play` types into the real input via the DOM (`storybook/test`'s
// userEvent), the same way a user would, to actually exercise the filtered list.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { GraphSearch, type SearchItem } from './GraphSearch'

const ITEMS: SearchItem[] = [
    { id: 'housing-0', label: 'Housing', sub: 'logistics' },
    { id: 'internship-1', label: 'Internship', sub: 'project' },
    { id: 'essay-2', label: 'Essay', sub: 'reading' },
    { id: 'reading-list-3', label: 'Reading List', sub: 'reading' },
    { id: 'project-roadmap-4', label: 'Project Roadmap', sub: 'project' },
    { id: 'meeting-notes-5', label: 'Meeting Notes', sub: 'project' },
    { id: 'tag:project', label: '#project' },
    { id: 'tag:reading', label: '#reading' },
]

const meta = {
    title: 'App/GraphSearch',
    component: GraphSearch,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof GraphSearch>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Typing "e" matches most of the fixture — a typical multi-row result list, first row
 *  previewed/highlighted automatically. */
export const Default: Story = {
    render: () => (
        <GraphSearch
            items={ITEMS}
            onPreview={noop}
            onFly={noop}
            onClose={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const input =
            within(canvasElement).getByPlaceholderText('nodes')
        await userEvent.type(input, 'e')
        // The rows are ui/PaletteRow: options in a listbox, exactly one carrying the cursor.
        const rows = await waitFor(() => {
            const found = within(canvasElement).getAllByRole('option')
            expect(found.length).toBeGreaterThan(1)
            return found
        })
        expect(rows.filter(r => r.hasAttribute('data-selected'))).toHaveLength(1)
        expect(rows[0].getAttribute('aria-selected')).toBe('true')
    },
}

/** The real app's register: GraphView's find panel always passes `embedded`, which switches on the
 *  ASCII node glyph before each name. The glyph follows the cursor row's ink. */
export const Embedded: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            <GraphSearch
                embedded
                items={ITEMS}
                onPreview={noop}
                onFly={noop}
                onClose={noop}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await userEvent.type(
            within(canvasElement).getByPlaceholderText('nodes'),
            'e',
        )
        const rows = await waitFor(() => {
            const found = within(canvasElement).getAllByRole('option')
            expect(found.length).toBeGreaterThan(1)
            return found
        })
        const glyph = (row: HTMLElement) =>
            [...row.querySelectorAll('span')].find(
                s => s.textContent === 'o',
            ) as HTMLElement
        // Selected row's glyph takes the accent; every other row's stays structural (--faint) —
        // read off the computed colour, so a rule that stopped matching shows as equal colours.
        const selectedInk = getComputedStyle(glyph(rows[0])).color
        const restingInk = getComputedStyle(glyph(rows[1])).color
        expect(selectedInk).not.toBe(restingInk)
    },
}

/** A query with no matches — the "No matches" empty row. */
export const NoMatches: Story = {
    render: () => (
        <GraphSearch
            items={ITEMS}
            onPreview={noop}
            onFly={noop}
            onClose={noop}
        />
    ),
    play: async ({ canvasElement }) => {
        const input =
            within(canvasElement).getByPlaceholderText('nodes')
        await userEvent.type(input, 'zzz-no-match')
        // Sentence case, as written — the old line was forced to uppercase by CSS.
        const empty = await within(canvasElement).findByText('No matches')
        expect(getComputedStyle(empty).textTransform).toBe('none')
    },
}
