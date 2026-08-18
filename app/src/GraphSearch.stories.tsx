// Visual spec for <GraphSearch> — the graph-scoped search overlay (SearchBar over a
// keyboard-navigable, substring-filtered node list). `query` is an UNCONTROLLED internal
// signal with no prop to seed it, and the results list is hard-gated on a non-empty query
// (`<Show when={query().trim()}>` — see GraphSearch.tsx) — a story that only ever passes
// `items` would show nothing but the bare search bar, which is real behavior but shows none
// of the component. `play` types into the real input via the DOM (`storybook/test`'s
// userEvent), the same way a user would, to actually exercise the filtered list.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { userEvent, within } from 'storybook/test'
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
            within(canvasElement).getByPlaceholderText('Search graph...')
        await userEvent.type(input, 'e')
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
            within(canvasElement).getByPlaceholderText('Search graph...')
        await userEvent.type(input, 'zzz-no-match')
    },
}
