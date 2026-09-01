// Visual spec for <App> — the root shell: tab/pane tree, sidebar + file tree, the always-
// mounted graph floater, top strip, status bar, global keybindings. App takes NO props (it
// owns its own settings/tree/graph fetches, window id, localStorage-persisted tab layout), so
// this is the one component in the app that can only ever be smoke-tested: mount it over the
// shared fakeTransport with a small seeded vault and assert the real chrome renders — the
// sidebar, the tab rail, the graph home tab — not a reproduction of the whole app's behaviour
// (every piece App composes — Sidebar, FileTree, GraphView, PaneContent, ChatView, Terminal,
// … — already has its own, far more thorough stories).
//
// FRESH STATE PER STORY: App reads its tab layout from localStorage (`windowId.ts`'s
// `tabsStorageKey`), keyed by a window id resolved from `?w=` (absent here, so every story
// shares the SAME default key). `localStorage.clear()` at the top of `render` keeps each story
// independent of whatever a previous one left behind in this browser profile — a real risk here
// since, unlike most stories, App persists state outside Solid/the fake transport entirely.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import App from './App'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { SAMPLE_ROWS } from './ui/_baseFixtures'

const meta = {
    title: 'App/App',
    component: App,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

// Fixed px, not vh — same reasoning as GraphView.stories.tsx / Editor.stories.tsx: the
// Storybook preview iframe is short with the Controls panel open, and App fills its parent via
// `.app-shell { height: 100% }`.
const STORY_H = '760px'

const Frame = (props: { children: unknown }) => (
    <div style={{ height: STORY_H, width: '100%' }}>{props.children as never}</div>
)

/** A small seeded vault so the file tree and the graph home tab both have real content, not an
 *  empty vault's first-run state. Deliberately ROOT-level paths (not the shared fixture's own
 *  `projects/`/`eng/` folders): FileTree renders folders COLLAPSED by default, so a note inside
 *  one is invisible to a query until something expands it — a root file needs no interaction to
 *  prove the tree has real content. */
function seedVault(): void {
    localStorage.clear()
    const names = SAMPLE_ROWS.map(r => r.file.name)
    const files = Object.fromEntries(
        names.map(name => [
            `${name}.md`,
            `# ${name}\n\nNotes for **${name}**.\n`,
        ]),
    )
    setTransport(
        fakeTransport({
            files,
            graph: {
                nodes: names.map(name => ({
                    id: `${name}.md`,
                    kind: 'note',
                    label: name,
                    folder: '',
                })),
                edges: [],
            },
        }),
    )
}

/** A fresh window: no persisted tabs, so App seeds one Knowledge Graph tab (the "tabs never
 *  empty" invariant — see the component header's Panes/Tabs section) — the app's actual home
 *  screen on first open. Asserts the real chrome mounted: the app shell, the sidebar's file
 *  tree (there is no "VAULT" eyebrow above it — removed 2026-08-28, see Sidebar.tsx's own
 *  header comment — so this checks the tree's `aria-label` instead), and the graph tab's
 *  transparent placeholder host (the real renderer lives in the always-mounted `.graph-floater`
 *  overlay, not inside the pane). */
export const Default: Story = {
    render: () => {
        seedVault()
        return (
            <Frame>
                <App />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvasElement.querySelector('.app-shell')).not.toBeNull()
        })
        expect(canvas.getByLabelText('Vault files')).toBeInTheDocument()
        await waitFor(() => {
            expect(
                canvasElement.querySelector('[data-graph-host], .graph-floater'),
            ).not.toBeNull()
        })
        // The seeded vault's notes are real content, not an empty tree.
        await waitFor(() => {
            expect(
                canvas.getByText('Draft the roadmap'),
            ).toBeInTheDocument()
        })
    },
}
