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
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import App from './App'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { SAMPLE_ROWS } from './ui/_baseFixtures'
import { recheckUpdate } from './updateCheck'
import { DEFAULTS, setSettings, type AppSettings } from './settings'

const meta = {
    title: 'App/App',
    component: App,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

// Fixed px, not vh — same reasoning as GraphView.stories.tsx / Editor.stories.tsx: the
// Storybook preview iframe is short with the Controls panel open, and App fills its parent via
// the app shell's `height: 100%`.
const STORY_H = '760px'

const Frame = (props: { children: unknown }) => (
    <div style={{ height: STORY_H, width: '100%' }}>
        {props.children as never}
    </div>
)

/** A small seeded vault so the file tree and the graph home tab both have real content, not an
 *  empty vault's first-run state. Deliberately ROOT-level paths (not the shared fixture's own
 *  `projects/`/`eng/` folders): FileTree renders folders COLLAPSED by default, so a note inside
 *  one is invisible to a query until something expands it — a root file needs no interaction to
 *  prove the tree has real content. */
function seedVault(
    opts: {
        updateBehind?: number
        /** A `layout:` arrangement for this story; absent = the schema defaults. The store is
         *  module-level and shared by every story in the browser, so it is always reset. */
        layout?: Partial<AppSettings['layout']>
    } = {},
): void {
    localStorage.clear()
    setSettings('layout', { ...DEFAULTS.layout, ...opts.layout })
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
            ...(opts.updateBehind
                ? {
                      updateStatus: {
                          available: true,
                          behind: opts.updateBehind,
                          localSha: 'abc1234',
                          remoteSha: 'def5678',
                          builtSha: 'abc1234',
                          dirty: false,
                      },
                  }
                : {}),
        }),
    )
    // updateCheck.ts's status is a MODULE-level signal shared by every story in this browser, so
    // re-read it against this story's transport — otherwise the banner one story shows would leak
    // into the next.
    recheckUpdate()
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
            expect(canvasElement.querySelector('[data-app-shell]')).not.toBeNull()
        })
        expect(canvas.getByLabelText('Vault files')).toBeInTheDocument()
        await waitFor(() => {
            expect(
                canvasElement.querySelector(
                    '[data-graph-host], .graph-floater',
                ),
            ).not.toBeNull()
        })
        // The seeded vault's notes are real content, not an empty tree.
        await waitFor(() => {
            expect(canvas.getByText('Draft the roadmap')).toBeInTheDocument()
        })
    },
}

/** The whole app with an update available — the banner in its real place at the top of the
 *  editor column, over the graph tab's view bar, beside the sidebar's toolbar and the tab rail, so
 *  its height, inset and hairline can be checked against the chrome around it. */
export const WithUpdateBanner: Story = {
    render: () => {
        seedVault({ updateBehind: 5 })
        return (
            <Frame>
                <App />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(
                canvas.getByText(/Bismuth update available/),
            ).toBeInTheDocument()
        })
    },
}

// Regression guard for #56 ("opening a file never replaces a pane"). The two removed
// `openFile` bypasses (a Bases card click, app-control's `openTab`) used to pass
// `newTab: true`, which routed to `openInNewTab` (now `openTool`) — and THAT function, on
// an already-split active tab, fills the FOCUSED pane in place instead of opening a fresh
// tab. `onOpen` (App.tsx's `bismuth-open` handler) now always calls `openFile`, which never
// does that. NOTE: this asserts on both the `data-pane-content` attribute (the pane's
// content id) and each pane's rendered text, so the guard catches a rewrite either way.
export const OpenWithSplitKeepsPanes: Story = {
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
            expect(canvasElement.querySelector('[data-app-shell]')).not.toBeNull()
        })

        const noteA = 'Draft the roadmap.md'
        const noteB = 'Ship storybook coverage.md'

        // Open note A — the same path a wikilink/file-tree click/switcher result takes.
        window.dispatchEvent(new CustomEvent('bismuth-open', { detail: noteA }))
        await waitFor(() => {
            expect(
                canvasElement.querySelectorAll('[data-pane-leaf]').length,
            ).toBe(1)
        })

        // Split the focused pane (Mod+D) — the tab now holds two panes: A + an empty one.
        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'd',
                code: 'KeyD',
                metaKey: true,
                bubbles: true,
                cancelable: true,
            }),
        )
        await waitFor(() => {
            expect(
                canvasElement.querySelectorAll('[data-pane-leaf]').length,
            ).toBe(2)
        })
        // Multi-pane tabs show a "N panes" chip label (tabBarLabel) instead of the content
        // name — the one handle that still identifies this tab once it's no longer active.
        await waitFor(() => {
            expect(canvas.getByText('2 panes')).toBeInTheDocument()
        })

        const chipsBefore =
            canvasElement.querySelectorAll('[data-tab-chip]').length
        const panesBefore = Array.from(
            canvasElement.querySelectorAll('[data-pane-leaf]'),
        ).map(el => el.textContent)
        const paneContentsBefore = Array.from(
            canvasElement.querySelectorAll('[data-pane-leaf]'),
        ).map(el => el.getAttribute('data-pane-content'))
        // Pins two things at once: the runtime hook actually exists (viewDrag's
        // reference geometry silently degrades without it), and note A really opened
        // before the split (the graph home tab also renders one pane).
        expect(paneContentsBefore.slice().sort()).toEqual(['::empty', noteA])

        // Fire the open event for a DIFFERENT note while this split tab is active and its
        // EMPTY pane is focused — the exact shape that used to clobber the focused pane.
        window.dispatchEvent(
            new CustomEvent('bismuth-open', { detail: { path: noteB } }),
        )
        // A fresh top-level tab must appear — not a rewrite of the focused pane in place.
        await waitFor(() => {
            expect(
                canvasElement.querySelectorAll('[data-tab-chip]').length,
            ).toBe(chipsBefore + 1)
        })

        // Re-activate the split tab (only the ACTIVE tab's panes stay mounted, so this is
        // the only way to see its DOM again) and confirm nothing in it changed.
        fireEvent.click(canvas.getByText('2 panes'))
        await waitFor(() => {
            const leaves = canvasElement.querySelectorAll('[data-pane-leaf]')
            expect(leaves.length).toBe(2)
            expect(Array.from(leaves).map(el => el.textContent)).toEqual(
                panesBefore,
            )
            expect(
                Array.from(leaves).map(el =>
                    el.getAttribute('data-pane-content'),
                ),
            ).toEqual(paneContentsBefore)
        })
        // Neither surviving pane was rewritten to hold the newly-opened note.
        expect(
            Array.from(canvasElement.querySelectorAll('[data-pane-leaf]')).some(
                el => el.textContent?.includes('Ship storybook coverage'),
            ),
        ).toBe(false)
    },
}

/** `layout:` mirrored — sidebar on the RIGHT, rail on the LEFT, sections `[files, graph, toolbar]`
 *  (toolbar at the bottom with its hairline on top), no status bar. A note is open so the mini
 *  graph docks in the sidebar square; the play function checks the arrangement is real: the cells
 *  swapped edges, the status bar is gone, and the docked graph sits inside the right sidebar. */
export const MirroredLayout: Story = {
    render: () => {
        seedVault({
            layout: {
                sidebarSide: 'right',
                tabRailSide: 'left',
                sidebar: ['files', 'graph', 'toolbar'],
                statusBar: false,
            },
        })
        return (
            <Frame>
                <App />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(canvasElement.querySelector('[data-app-shell]')).not.toBeNull()
        })
        window.dispatchEvent(
            new CustomEvent('bismuth-open', { detail: 'Draft the roadmap.md' }),
        )
        await waitFor(() => {
            expect(canvasElement.querySelector('[data-pane-leaf]')).not.toBeNull()
        })
        const sidebar = canvasElement.querySelector<HTMLElement>(
            '[data-shell-cell="sidebar"]',
        )!
        const rail = canvasElement.querySelector<HTMLElement>(
            '[data-shell-cell="rail"]',
        )!
        const frame = canvasElement.querySelector<HTMLElement>(
            '[data-app-shell]',
        )!.getBoundingClientRect()
        await waitFor(() => {
            expect(
                Math.abs(sidebar.getBoundingClientRect().right - frame.right),
            ).toBeLessThan(2)
            expect(
                Math.abs(rail.getBoundingClientRect().left - frame.left),
            ).toBeLessThan(2)
            // no status bar → the grid reaches the bottom of the frame
            expect(
                Math.abs(sidebar.getBoundingClientRect().bottom - frame.bottom),
            ).toBeLessThan(2)
        })
        // the docked graph sits inside the right sidebar
        await waitFor(() => {
            const f = canvasElement
                .querySelector<HTMLElement>('[data-graph-floater]')!
                .getBoundingClientRect()
            const s = sidebar.getBoundingClientRect()
            expect(f.left).toBeGreaterThanOrEqual(s.left - 1)
            expect(f.right).toBeLessThanOrEqual(s.right + 1)
        })
    },
}

/** Boot the app on a seeded vault with `layout` applied, open a note so the sidebar's mini graph
 *  docks, and hand back the real geometry the arrangement stories assert on. */
async function openArranged(canvasElement: HTMLElement) {
    await waitFor(() => {
        expect(canvasElement.querySelector('[data-app-shell]')).not.toBeNull()
    })
    window.dispatchEvent(new CustomEvent('bismuth-open', { detail: 'Draft the roadmap.md' }))
    await waitFor(() => {
        expect(canvasElement.querySelector('[data-pane-leaf]')).not.toBeNull()
        expect(canvasElement.querySelector('[data-graph-floater]')).not.toBeNull()
    })
    const rect = (sel: string) => canvasElement.querySelector<HTMLElement>(sel)!
    return {
        frame: rect('[data-app-shell]'),
        sidebar: rect('[data-shell-cell="sidebar"]'),
        main: rect('[data-shell-cell="main"]'),
        rail: rect('[data-shell-cell="rail"]'),
        toolbar: rect('[data-sidebar-toolbar]'),
        graph: rect('[data-graph-floater]'),
        files: rect('[data-ft-path]'),
    }
}

/** The three grid cells' left edges, left to right, as names. */
const cellOrder = (els: { sidebar: HTMLElement; main: HTMLElement; rail: HTMLElement }) =>
    (['sidebar', 'main', 'rail'] as const)
        .map(k => [k, els[k].getBoundingClientRect().left] as const)
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => k)

const arranged = (layout: Partial<AppSettings['layout']>) => () => {
    seedVault({ layout })
    return (
        <Frame>
            <App />
        </Frame>
    )
}

/** Sidebar moved to the right edge; the rail defaults right too, so the sidebar is outermost:
 *  editor | rail | sidebar, the sidebar's hairline on its editor-facing (left) edge. */
export const SidebarRight: Story = {
    render: arranged({ sidebarSide: 'right' }),
    play: async ({ canvasElement }) => {
        const e = await openArranged(canvasElement)
        await waitFor(() => expect(cellOrder(e)).toEqual(['main', 'rail', 'sidebar']))
        const cs = getComputedStyle(e.sidebar.querySelector('aside')!)
        expect(cs.borderLeftWidth).toBe('1px')
        expect(cs.borderRightWidth).toBe('0px')
    },
}

/** Tab rail moved to the left edge; the sidebar defaults left too, so the sidebar is outermost:
 *  sidebar | rail | editor, hairline on the sidebar's right edge. */
export const RailLeft: Story = {
    render: arranged({ tabRailSide: 'left' }),
    play: async ({ canvasElement }) => {
        const e = await openArranged(canvasElement)
        await waitFor(() => expect(cellOrder(e)).toEqual(['sidebar', 'rail', 'main']))
        const cs = getComputedStyle(e.sidebar.querySelector('aside')!)
        expect(cs.borderRightWidth).toBe('1px')
        expect(cs.borderLeftWidth).toBe('0px')
    },
}

/** Sidebar and rail both on the left: columns sidebar | rail | editor, hairline on the sidebar's
 *  right edge. */
export const BothLeft: Story = {
    render: arranged({ sidebarSide: 'left', tabRailSide: 'left' }),
    play: async ({ canvasElement }) => {
        const e = await openArranged(canvasElement)
        await waitFor(() => expect(cellOrder(e)).toEqual(['sidebar', 'rail', 'main']))
        const cs = getComputedStyle(e.sidebar.querySelector('aside')!)
        expect(cs.borderRightWidth).toBe('1px')
        expect(cs.borderLeftWidth).toBe('0px')
    },
}

/** Sidebar and rail both on the right: columns editor | rail | sidebar, hairline on the sidebar's
 *  left (editor-facing) edge. */
export const BothRight: Story = {
    render: arranged({ sidebarSide: 'right', tabRailSide: 'right' }),
    play: async ({ canvasElement }) => {
        const e = await openArranged(canvasElement)
        await waitFor(() => expect(cellOrder(e)).toEqual(['main', 'rail', 'sidebar']))
        const cs = getComputedStyle(e.sidebar.querySelector('aside')!)
        expect(cs.borderLeftWidth).toBe('1px')
        expect(cs.borderRightWidth).toBe('0px')
    },
}

/** Sidebar order files, graph, toolbar: the file tree on top, the filled graph square below it,
 *  and the toolbar band as the bottom row of the column. */
export const ToolbarLast: Story = {
    render: arranged({ sidebar: ['files', 'graph', 'toolbar'] }),
    play: async ({ canvasElement }) => {
        const e = await openArranged(canvasElement)
        await waitFor(() => {
            const f = e.files.getBoundingClientRect()
            const g = e.graph.getBoundingClientRect()
            const t = e.toolbar.getBoundingClientRect()
            expect(f.top).toBeLessThan(g.top)
            expect(g.bottom).toBeLessThanOrEqual(t.top + 1)
            expect(Math.abs(t.bottom - e.sidebar.getBoundingClientRect().bottom)).toBeLessThan(2)
        })
    },
}

/** Sidebar order graph, files, toolbar: the graph square at the very top of the column, the file
 *  tree under it, toolbar band last. */
export const GraphFirst: Story = {
    render: arranged({ sidebar: ['graph', 'files', 'toolbar'] }),
    play: async ({ canvasElement }) => {
        const e = await openArranged(canvasElement)
        await waitFor(() => {
            const f = e.files.getBoundingClientRect()
            const g = e.graph.getBoundingClientRect()
            const t = e.toolbar.getBoundingClientRect()
            expect(g.bottom).toBeLessThanOrEqual(f.top + 1)
            expect(f.bottom).toBeLessThanOrEqual(t.top + 1)
            expect(g.top).toBeLessThan(e.sidebar.getBoundingClientRect().top + 40)
        })
    },
}

/** `statusBar: false` — no bottom strip, so the sidebar column runs to the very bottom of the
 *  frame. */
export const NoStatusBar: Story = {
    render: arranged({ statusBar: false }),
    play: async ({ canvasElement }) => {
        const e = await openArranged(canvasElement)
        await waitFor(() => {
            expect(
                Math.abs(
                    e.sidebar.getBoundingClientRect().bottom - e.frame.getBoundingClientRect().bottom,
                ),
            ).toBeLessThan(2)
        })
    },
}

/** `layout.sidebar: [toolbar, files]` — no `graph` section, so with a note open there is no docked
 *  mini graph anywhere: the always-mounted floater is parked (invisible, inert). */
export const GraphNotDocked: Story = {
    render: () => {
        seedVault({ layout: { sidebar: ['toolbar', 'files'] } })
        return (
            <Frame>
                <App />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(canvasElement.querySelector('[data-app-shell]')).not.toBeNull()
        })
        window.dispatchEvent(
            new CustomEvent('bismuth-open', { detail: 'Draft the roadmap.md' }),
        )
        await waitFor(() => {
            expect(canvasElement.querySelector('[data-pane-leaf]')).not.toBeNull()
        })
        const floater = canvasElement.querySelector<HTMLElement>('[data-graph-floater]')
        expect(floater).not.toBeNull()
        await waitFor(() => {
            const cs = getComputedStyle(floater!)
            expect(cs.visibility).toBe('hidden')
            expect(cs.pointerEvents).toBe('none')
        })
    },
}
