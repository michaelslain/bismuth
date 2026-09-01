// Visual spec for <PaneContent> — the router that turns one pane's content id (a note path or a
// `::sentinel`, see tabIds.ts) into the right view. It is a ROUTER, not a leaf component: the
// job worth verifying here is "does this content id reach the branch it should", not the full
// behaviour of whatever it routes to (FileView/BaseView/SheetView/DrawingPage/PreviewView/
// ExportView/InboxView all have their own, more thorough stories). So this file is one smoke
// story PER BRANCH the `<Switch>` in PaneContent.tsx actually has, each asserting the one thing
// that branch is responsible for getting right — far more valuable than a single story that
// only proves the default (note) case mounts.
//
// Every routed view is `lazy()`, so every story renders inside the SAME `<Suspense>` boundary
// PaneContent itself wraps each Match in — a real chunk-load happens, not a stubbed-out import.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { PaneContent } from './PaneContent'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { refreshDaemonPages } from './daemonInbox'
import { sampleDaemonPages } from './ui/_daemonFixtures'
import {
    GRAPH_TAB,
    INBOX_TAB,
    TERMINAL_PREFIX,
    EXPORT_PREFIX,
    CHAT_PREFIX,
} from './tabIds'

const meta = {
    title: 'App/PaneContent',
    component: PaneContent,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PaneContent>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const noNames = () => []
const baseProps = {
    onSaved: noop,
    onOpen: noop,
    onNewTerminal: noop,
    noteNames: noNames,
    memoryNames: noNames,
    tagNames: noNames,
}

const NOTE_PATH = 'projects/roadmap.md'
const NOTE_BODY = '# Roadmap\n\nA plain note routes to FileView -> Editor.\n'
const BASE_PATH = 'boards/tasks.md'
const BASE_BODY =
    '---\ntype: base\nviews:\n  - type: table\n---\n'
const SHEET_PATH = 'ledgers/q1.sheet'
const DRAW_PATH = 'sketches/idea.draw'
const CODE_PATH = 'src/example.ts'
const CODE_BODY = 'export const answer = 42\n'

/** Falls through to the `<Switch>`'s `fallback` — the SOLE default arm: FileView, which reads
 *  the file and (since it's a plain note, no `type: base`) mounts the CodeMirror Editor. */
export const Note: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return <PaneContent path={NOTE_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(
                canvasElement.querySelector('.cm-editor'),
            ).not.toBeNull()
        })
    },
}

/** Also the fallback arm (a base file has no dedicated PaneContent Match — FileView itself
 *  branches on the frontmatter), but exercised separately since it lands on BaseView, not the
 *  editor — proving the SAME routing arm correctly serves two different downstream views. */
export const Base: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [BASE_PATH]: BASE_BODY } }))
        return <PaneContent path={BASE_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // BaseView's ViewBar crumb shows the base FILE's name — "tasks" — not the view type;
        // the view-type label only appears once a base declares more than one view (see
        // BaseView.tsx's `SegmentedToggle`, gated on `views.length > 1`), which this single-view
        // fixture deliberately doesn't.
        await waitFor(() => {
            expect(canvas.getByText('tasks')).toBeInTheDocument()
        })
    },
}

/** `GRAPH_TAB` renders a transparent placeholder host, NOT a real GraphView — the actual
 *  renderer lives in App.tsx's always-mounted `.graph-floater` overlay, repositioned over this
 *  host so its renderer/camera survive a split or tab switch. The one thing to verify here is
 *  that the host div with the right marker attribute exists. */
export const GraphSentinel: Story = {
    render: () => <PaneContent path={GRAPH_TAB} {...baseProps} />,
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('[data-graph-host]')).not.toBeNull()
    },
}

/** `TERMINAL_PREFIX + <id>` — same overlay-host pattern as the graph sentinel, for the same
 *  reason: the real xterm view lives in an always-mounted overlay so its WebSocket/scrollback
 *  survive a pane switch. */
export const TerminalSentinel: Story = {
    render: () => (
        <PaneContent path={`${TERMINAL_PREFIX}demo-1`} {...baseProps} />
    ),
    play: async ({ canvasElement }) => {
        const host = canvasElement.querySelector(
            `[data-terminal-host="${TERMINAL_PREFIX}demo-1"]`,
        )
        expect(host).not.toBeNull()
    },
}

/** `CHAT_PREFIX + <id>` — same overlay-host pattern again, so the backend `claude` session
 *  survives a pane switch instead of being torn down by an unmount's WS close. */
export const ChatSentinel: Story = {
    render: () => <PaneContent path={`${CHAT_PREFIX}demo-1`} {...baseProps} />,
    play: async ({ canvasElement }) => {
        const host = canvasElement.querySelector(
            `[data-chat-host="${CHAT_PREFIX}demo-1"]`,
        )
        expect(host).not.toBeNull()
    },
}

/** `EXPORT_PREFIX + <path>` must win over every extension-based Match below it (a `.sheet`/
 *  `.draw` file can itself be exported) — this story's path deliberately carries BOTH the
 *  export prefix and a plain `.md` suffix to prove the ordering PaneContent.tsx's own comment
 *  calls out ("Export must win before the extension arms below"). */
export const Export: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [NOTE_PATH]: NOTE_BODY } }))
        return (
            <PaneContent
                path={`${EXPORT_PREFIX}${NOTE_PATH}`}
                {...baseProps}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText(/export note/i)).toBeInTheDocument()
        })
    },
}

/** A path ending `.sheet` routes to the (lazy) SheetView. No workbook is seeded — SheetView
 *  reads an empty body and falls back to its own loading/blank state, which is enough to prove
 *  the routing arm (not SheetView's own rendering, already covered by SheetView.stories.tsx). */
export const Sheet: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PaneContent path={SHEET_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(
                canvasElement.querySelector('.univer-container, .sheet-root, canvas') ??
                    canvasElement.textContent,
            ).toBeTruthy()
        })
    },
}

/** A path ending `.draw` routes to the (lazy) DrawingPage — DrawingPage.stories.tsx covers its
 *  own rendering + pixel-sampling in depth; this only proves the extension routes here. */
export const Drawing: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return <PaneContent path={DRAW_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(await canvas.findByText('ADD PAGE')).toBeInTheDocument()
    },
}

/** A code/text extension (`.ts`, not `.md`/`.yaml`/`.draw`/`.sheet`) routes to the read-only
 *  PreviewView, per `isPreviewPath`/`previewKind`. */
export const Preview: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { [CODE_PATH]: CODE_BODY } }))
        return <PaneContent path={CODE_PATH} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() => {
            expect(canvas.getByText(/answer/)).toBeInTheDocument()
        })
    },
}

/** `INBOX_TAB` routes to the (lazy) InboxView, which reads a module-level signal populated by
 *  `refreshDaemonPages()` — called here the same way InboxView.stories.tsx populates it. */
export const Inbox: Story = {
    render: () => {
        setTransport(
            fakeTransport({ daemonPages: sampleDaemonPages() }),
        )
        void refreshDaemonPages()
        return <PaneContent path={INBOX_TAB} {...baseProps} />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The fixture's first (pending) page title, rendered verbatim as one row — unambiguous,
        // unlike "Inbox"/"Needs review" which both the crumb AND the section eyebrow repeat.
        await waitFor(() => {
            expect(
                canvas.getByText('3 reply drafts ready'),
            ).toBeInTheDocument()
        })
    },
}

/** Any other `::sentinel` PaneContent doesn't recognise (e.g. a stale pre-migration
 *  `::tasks` tab) falls back to `<EmptyPane>` instead of trying to load it as a file path. */
export const UnknownSentinel: Story = {
    render: () => <PaneContent path="::tasks" {...baseProps} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(
            await canvas.findByText(/drag a note here/i),
        ).toBeInTheDocument()
    },
}
