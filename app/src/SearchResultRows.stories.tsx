// Visual spec for <SearchResultRows> — the `.sresult` result rows shared by the Cmd+O switcher's
// keyword-content and Bismuth-AI result lists (palette/SwitcherBar.tsx). Pure props in
// (SearchResult[], app/src/searchOpts.ts) + callbacks out; no IO.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { SearchResultRows } from './SearchResultRows'
import type { SearchResult } from './searchOpts'

const KEYWORD_RESULTS: SearchResult[] = [
    {
        path: 'reading/Weekly Review.md',
        matchCount: 2,
        snippets: [
            {
                line: 4,
                before: 'Finished the ',
                match: 'roadmap',
                after: ' draft and sent it for review.',
            },
            {
                line: 11,
                before: "Next week's ",
                match: 'roadmap',
                after: ' work starts with the API design.',
            },
        ],
    },
    {
        path: 'projects/Q3 Planning.md',
        matchCount: 1,
        snippets: [
            {
                line: 22,
                before: 'See the ',
                match: 'roadmap',
                after: ' note for the full timeline.',
            },
        ],
    },
]

/** The AI prompt-search path (/search-prompt) sets `reason` — a one-line rationale rendered
 *  as a faint caption; the literal keyword path never sets it. */
const AI_RESULTS: SearchResult[] = [
    {
        path: 'Housing.md',
        matchCount: 1,
        reason: 'Mentions the lease renewal deadline you asked about.',
        snippets: [
            {
                line: 3,
                before: 'The ',
                match: 'lease renewal',
                after: ' deadline is September 1st.',
            },
        ],
    },
]

/** A long paragraph match (the lead-in is shortened so the match lands on line one, the tail is
 *  clamped to two lines), a deep folder path that must ellipsize before the count, and a
 *  three-digit line number spilling into the inset rather than shoving the text. */
const LONG_RESULTS: SearchResult[] = [
    {
        path: 'dreams/2024-11-16 dream.md',
        matchCount: 1,
        snippets: [
            {
                line: 7,
                before:
                    'uff. Overall just very odd structure of the dorm. We also lived very close to a ',
                match: 'chicken',
                after: ' place for some reason and met some people that I have no idea who they are. I am still with Cole when this is happening.',
            },
        ],
    },
    {
        path: 'archive/school 2025/classes/CYPLAN 115/notes/2025-10-16 Reading Response.md',
        matchCount: 12,
        snippets: [
            {
                line: 124,
                before: 'factories → Japan bans Chinese ',
                match: 'chicken',
                after: ' → Buys from Thai CP factories → CP profits',
            },
        ],
    },
]

const meta = {
    title: 'App/SearchResultRows',
    component: SearchResultRows,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof SearchResultRows>

export default meta
type Story = StoryObj<typeof meta>

/** Plain keyword-match results — two files, each with its own snippet(s). */
export const Default: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <SearchResultRows results={KEYWORD_RESULTS} onOpen={() => {}} />
        </div>
    ),
}

/** An AI-prompt result: the rationale caption above the matched snippet. */
export const WithAiReason: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <SearchResultRows results={AI_RESULTS} onOpen={() => {}} />
        </div>
    ),
}

/** Keyboard-nav highlight: `selected` marks a row (the switcher walks these with Up/Down). */
export const SelectedRow: Story = {
    render: () => {
        const [selected, setSelected] = createSignal(1)
        return (
            <div style={{ width: '420px' }}>
                <SearchResultRows
                    results={KEYWORD_RESULTS}
                    selected={selected()}
                    onOpen={() => {}}
                    onRowPointerMove={i => setSelected(i)}
                />
            </div>
        )
    },
}

/** Long snippet + deep folder: the two-line clamp, the shortened lead-in and the path ellipsis. */
export const LongSnippetAndPath: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <SearchResultRows results={LONG_RESULTS} onOpen={() => {}} />
        </div>
    ),
}

/** No results — the switcher renders nothing (an empty <For>); shown here as the same empty
 *  container the real switcher list sits in, so the "nothing to see" state is explicit. */
export const Empty: Story = {
    render: () => (
        <div
            style={{
                width: '420px',
                color: 'var(--faint)',
                'font-size': 'var(--fs-body)',
            }}
        >
            <SearchResultRows results={[]} onOpen={() => {}} />
            (no rows render)
        </div>
    ),
}
