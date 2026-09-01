// Visual spec for <SwitcherBar> — the in-window Cmd+O switcher: the app's ONE search surface,
// unifying fuzzy file-name matches, keyword content matches (POST /search), and a one-shot
// Bismuth AI escalation (POST /search-prompt) in a single navigable list. See the component's
// own file-level comment for the full shape; this file exercises each of its phases for real.
//
// FIXTURE SEAM #1 — the file list. SwitcherBar reads from the module-level `vaultTree()` cache
// (treeStore.ts), refreshing it itself on every mount via `refreshVaultTree()` (`GET /tree`).
// Each story below layers `setTransport(fakeTransport({ tree: TREE }))` BEFORE rendering, same
// pattern as FileTree.stories.tsx, so the mount-time refresh populates the shared cache with
// fixture data instead of the global default (SAMPLE_ROWS-derived, which is fine too but this
// gives a richer set of names to fuzzy-match against).
//
// FIXTURE SEAM #2 — content search + AI. `fakeTransport`'s `postJson` only understands `/rows`
// and throws "unhandled POST(json) ..." on anything else (see ui/_fakeTransport.ts) — which
// SwitcherBar's content search silently swallows (best-effort) but which would reject the AI
// promise. Stories that need `/search` or `/search-prompt` to actually resolve wrap the fake
// with a small postJson override rather than fabricating a bespoke transport.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { SwitcherBar } from './SwitcherBar'
import { setTransport, type Transport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import type { TreeEntry } from '../../../core/src/graph'
import type { SearchResult } from '../searchOpts'

const meta = {
    title: 'Palette/SwitcherBar',
    component: SwitcherBar,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SwitcherBar>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

const TREE: TreeEntry[] = [
    { path: 'projects', kind: 'dir' },
    { path: 'projects/Internship.md', kind: 'file' },
    { path: 'projects/Project Roadmap.md', kind: 'file' },
    { path: 'reading', kind: 'dir' },
    { path: 'reading/Essay.md', kind: 'file' },
    { path: 'reading/Reading List.md', kind: 'file' },
    { path: 'Housing.md', kind: 'file' },
    { path: 'Budget.sheet', kind: 'file' },
]

/** Layers `/search` and/or `/search-prompt` responses onto the shared fakeTransport (which
 *  otherwise throws on both) — same "wrap the shared fake" approach TemplatePalette's
 *  `/templates` story uses. `search`/`searchPrompt` may each be a fixed result, an Error to
 *  reject with, or omitted to keep the fake's default throw (best-effort content search still
 *  degrades fine; an omitted `searchPrompt` only matters for stories that trigger it). */
function withSearch(opts: {
    search?: SearchResult[]
    searchPrompt?: SearchResult[] | Error | 'pending'
}): Transport {
    const base = fakeTransport({ tree: TREE })
    return {
        ...base,
        postJson: async <T,>(path: string, body: unknown): Promise<T> => {
            if (path === '/search' && opts.search)
                return opts.search as unknown as T
            if (path === '/search-prompt') {
                if (opts.searchPrompt === 'pending')
                    return new Promise<T>(() => {}) // never resolves — the loading phase
                if (opts.searchPrompt instanceof Error) throw opts.searchPrompt
                if (opts.searchPrompt) return opts.searchPrompt as unknown as T
            }
            return base.postJson<T>(path, body)
        },
    }
}

function typeQuery(canvasElement: HTMLElement, text: string) {
    const canvas = within(canvasElement)
    const input = canvas.getByPlaceholderText('Search files, contents, or ask…')
    return userEvent.type(input, text)
}

/** Open, empty query — the pre-warmed file list at rest, unfiltered (frecency order; a fresh
 *  Storybook session has no history, so incoming tree order). This is what the switcher shows
 *  the instant it opens, before any keystroke. */
export const Default: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
}

/** A fuzzy filename query narrows the list and highlights the matched characters — the same
 *  Highlight component PaletteModal uses. Unreachable declaratively (query is an internal
 *  signal), so `play` types it the way a person would. */
export const FilteredFileMatches: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
    play: async ({ canvasElement }) => {
        await typeQuery(canvasElement, 'road')
        // The matched row's label is fuzzy-highlighted (Highlight in PaletteModal.tsx wraps each
        // matched run in its own <span>), so "Roadmap" is never one contiguous text node — a
        // getByText copy query can't see across the split. The row carries a stable testid keyed
        // by the file path; assert on ITS textContent, which does concatenate every descendant.
        await waitFor(() => {
            const row = within(canvasElement).getByTestId(
                'palette-row-projects/Project Roadmap.md',
            )
            expect(row.textContent).toContain('Roadmap')
        })
    },
}

/** Keyword content matches under the "Content matches" divider — a note whose BODY matches but
 *  whose NAME doesn't. Debounced (150ms), so `play` waits for the section to actually appear. */
export const ContentMatches: Story = {
    render: () => {
        setTransport(
            withSearch({
                search: [
                    {
                        path: 'journal/2026-08-10.md',
                        matchCount: 2,
                        snippets: [
                            {
                                line: 4,
                                before: 'Talked through the ',
                                match: 'offsite',
                                after: ' agenda with the team.',
                            },
                        ],
                    },
                ],
            }),
        )
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
    play: async ({ canvasElement }) => {
        await typeQuery(canvasElement, 'offsite')
        await waitFor(
            () =>
                expect(
                    within(canvasElement).getByText('Content matches'),
                ).toBeInTheDocument(),
            { timeout: 2000 },
        )
    },
}

/** A question-shaped query (3+ words) with zero rows — the empty-state CTA offering "Press
 *  Enter to ask Bismuth AI", replacing the plain "No matching files" message. */
export const NoMatchesAskAiCta: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: [] }))
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
    play: async ({ canvasElement }) => {
        await typeQuery(canvasElement, 'what did I decide about the lease')
        // The hint text is split by an inline <kbd>Enter</kbd>, so it is never one contiguous
        // text node — a getByText copy query can't see across the split (RTL's own node-text
        // extraction only looks at an element's direct text-node children). The button carries
        // a stable testid; assert on ITS textContent, which does concatenate every descendant,
        // so this still proves the real copy renders.
        await waitFor(() => {
            const cta = within(canvasElement).getByTestId('switcher-ask-ai-cta')
            expect(cta.textContent).toContain(
                'Press Enter to ask Bismuth AI about your vault',
            )
        })
    },
}

/** A ONE-WORD zero-result search. This used to show a plain "No matching files" with no AI option
 *  at all — the gap the user reported ("if theres no search results, im not seeing the search with
 *  ai option anymore"). The CTA must appear here exactly as it does for a long question. */
export const NoMatchesShortQueryAskAiCta: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: [] }))
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
    play: async ({ canvasElement }) => {
        await typeQuery(canvasElement, 'meetign')
        // The hint text is split by an inline <kbd>Enter</kbd>, so a getByText copy query cannot
        // see across the split — assert on the button's textContent, which concatenates every
        // descendant. Same reasoning as NoMatchesAskAiCta above.
        await waitFor(() => {
            const cta = within(canvasElement).getByTestId('switcher-ask-ai-cta')
            expect(cta.textContent).toContain(
                'Press Enter to ask Bismuth AI about your vault',
            )
        })
        // And the plain empty state it replaced is genuinely gone, not merely also present.
        expect(
            within(canvasElement).queryByText('No matching files', {
                selector: 'div:not([class*="search-empty-title"])',
            }),
        ).toBeNull()
    },
}

/** The AI turn in flight (`/search-prompt` never resolves) — the loading panel, reached by
 *  actually clicking the CTA from `NoMatchesAskAiCta`'s state. */
export const AskAiLoading: Story = {
    render: () => {
        setTransport(withSearch({ search: [], searchPrompt: 'pending' }))
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
    play: async ({ canvasElement }) => {
        await typeQuery(canvasElement, 'what did I decide about the lease')
        const cta = await within(canvasElement).findByTestId(
            'switcher-ask-ai-cta',
        )
        await userEvent.click(cta)
        await waitFor(() =>
            expect(
                within(canvasElement).getByText(
                    'Searching your vault with Bismuth AI…',
                ),
            ).toBeInTheDocument(),
        )
    },
}

/** The AI turn resolved with results — rendered as the same `.sresult` snippet cards keyword
 *  content matches use (SearchResultRows.tsx), each carrying the AI's one-line `reason`. */
export const AskAiResults: Story = {
    render: () => {
        setTransport(
            withSearch({
                search: [],
                searchPrompt: [
                    {
                        path: 'Housing.md',
                        matchCount: 1,
                        reason: 'Mentions signing the new lease and the move-in date.',
                        snippets: [
                            {
                                line: 12,
                                before: 'We decided to ',
                                match: 'sign the 12-month lease',
                                after: ' starting September 1st.',
                            },
                        ],
                    },
                ],
            }),
        )
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
    play: async ({ canvasElement }) => {
        await typeQuery(canvasElement, 'what did I decide about the lease')
        const cta = await within(canvasElement).findByTestId(
            'switcher-ask-ai-cta',
        )
        await userEvent.click(cta)
        // SearchResultRows renders the result title via splitPath, which strips the extension
        // (SearchResultRows.tsx) — the card shows "Housing", never "Housing.md".
        await waitFor(() =>
            expect(
                within(canvasElement).getByText('Housing', {
                    exact: false,
                }),
            ).toBeInTheDocument(),
        )
    },
}

/** The AI turn rejected — the error panel, with the backend's own message surfaced verbatim
 *  (400 when Claude Code isn't installed, 500 on a model failure). */
export const AskAiError: Story = {
    render: () => {
        setTransport(
            withSearch({
                search: [],
                searchPrompt: new Error(
                    'Claude Code is not installed on this machine',
                ),
            }),
        )
        return <SwitcherBar onClose={noop} openFile={noop} />
    },
    play: async ({ canvasElement }) => {
        await typeQuery(canvasElement, 'what did I decide about the lease')
        const cta = await within(canvasElement).findByTestId(
            'switcher-ask-ai-cta',
        )
        await userEvent.click(cta)
        await waitFor(() =>
            expect(
                within(canvasElement).getByText(
                    'Claude Code is not installed on this machine',
                ),
            ).toBeInTheDocument(),
        )
    },
}
