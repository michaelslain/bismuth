// Visual spec for <FileTree> — the sidebar vault tree: ASCII-connector rows (`|--` / `` `-- ``),
// typed folder/file glyphs, sliding folder disclosure, the AI-visibility badge, and the muted
// system entries (`.daemon` / `.settings`) that sink to the bottom of their level.
//
// WHY THIS FILE EXISTS: `.ft-*` moved from the global App.css into FileTree.module.css, which
// HASHES every class name. A class left behind as a string literal still compiles and still
// renders — it just matches nothing, and the tree silently loses its styling. Nothing else in the
// repo can see that: typecheck reads no CSS, and Bun resolves `solid-js/web` to its server build
// so no unit test can mount this component. `bench/cssBaseline.ts` reads computed styles off
// Storybook, so these stories ARE the gate — before them, FileTree had no story at all and the
// migration was unprotected.
//
// FIXTURE SEAM: `FileTree` fetches `GET /tree` through `api` on mount, and the Storybook-wide
// `fakeTransport` (.storybook/preview.ts) derives its tree from `SAMPLE_ROWS` — a FLAT list of
// files with no directories, which would exercise no folder row, no disclosure and no connector
// depth. Each story therefore layers `setTransport(fakeTransport({ tree: TREE }))` on top, the
// same pattern SheetView.stories.tsx and editor/ink/InkOverlay.stories.tsx use. `tree` is a
// first-class seed field of the shared fake (ui/_fakeTransport.ts), not a bespoke transport.
//
// WHAT NEEDS `play` AND WHY: `open` (folder expanded) and `editing` (inline rename) are INTERNAL
// signals of FileTree with no prop to seed them — `open` starts as an empty Set, and `editing` is
// only ever set from the context menu's Rename row. They are unreachable declaratively, so those
// two stories drive the real DOM the way a user would rather than hand-writing markup: a story
// that renders its own `<div class="ft-row">` would prove nothing about the component. `active`
// and `drop-target` ARE props, so their stories stay declarative.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { FileTree } from './FileTree'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { SETTINGS_FILE } from './tabIds'
import type { TreeEntry } from '../../core/src/graph'

// A vault with the four row shapes the component distinguishes: folders, files, the visibility
// tiers, and the two runtime-managed system entries. `buildTree` (fileTreeModel.ts) infers
// intermediate directories from the paths, so a dir entry is only listed where it carries its own
// metadata (system flag, label override, resolved visibility).
const TREE: TreeEntry[] = [
    { path: 'projects', kind: 'dir' },
    { path: 'projects/Internship.md', kind: 'file' },
    { path: 'projects/Project Roadmap.md', kind: 'file' },
    // "chat-only" is the milder tier: muted badge, row otherwise normal.
    { path: 'projects/Standup.md', kind: 'file', visibility: 'chat-only' },
    { path: 'reading', kind: 'dir' },
    { path: 'reading/Essay.md', kind: 'file' },
    { path: 'reading/Reading List.md', kind: 'file' },
    // A folder resolved to "hidden" — the danger-tinted badge, cascading onto its children.
    { path: 'journal', kind: 'dir', visibility: 'hidden' },
    { path: 'journal/2026-08-16.md', kind: 'file', visibility: 'hidden' },
    { path: 'Housing.md', kind: 'file' },
    { path: 'Budget.sheet', kind: 'file' },
    // The system pair: both render muted + italic and sort to the bottom of the level.
    { path: '.daemon', kind: 'dir', isSystemFolder: true, label: 'bismuth' },
    { path: SETTINGS_FILE, kind: 'file' },
]

const noop = () => {}
/** No sidebar drag is in flight in most stories, so nothing is a drop target. */
const noDrop = () => null

/** Counts `startItemDrag` calls for `RenameBlocksRowDrag` below — reset in that story's `render`,
 *  read in its `play`. A module-level binding rather than a Storybook `fn()` mock because both
 *  closures just need one shared counter. */
let dragStarts = 0

/** The sidebar's real width, so connector prefixes and row truncation read as they ship. */
function Sidebar(props: { children: JSX.Element }) {
    return <div style={{ width: '260px' }}>{props.children}</div>
}

const meta = {
    title: 'App/FileTree',
    component: FileTree,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof FileTree>

export default meta
type Story = StoryObj<typeof meta>

/** The tree at rest, every folder collapsed. Covers the row grid (`ft-row`), the connector
 *  prefixes (`ft-prefix`), the typed glyphs (`ft-icon`), both visibility badge tiers
 *  (`ft-visibility-badge`, plus its `hidden` danger variant on `journal`), the muted `system`
 *  rows (`.daemon`, `.settings`), and the collapsed disclosure wrapper (`ft-collapse` at 0fr with
 *  `ft-collapse-inner` clipping it) — the folder subtrees are in the DOM but measure zero. */
export const Default: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return (
            <Sidebar>
                <FileTree
                    onOpen={noop}
                    startItemDrag={noop}
                    dropHighlight={noDrop}
                />
            </Sidebar>
        )
    },
}

/** A folder expanded. The ONLY story that reaches the `open` state class — `ft-collapse` flips
 *  0fr→1fr and its children mount, so this is also the only one that renders depth-1 connector
 *  prefixes (`|--` for middle children, `` `-- `` for the last). `open` lives in an internal
 *  signal with no prop, so the story clicks the real folder row. */
export const FolderOpen: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return (
            <Sidebar>
                <FileTree
                    onOpen={noop}
                    startItemDrag={noop}
                    dropHighlight={noDrop}
                />
            </Sidebar>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // testing-library matches on an element's DIRECT text-node children only, so the row div
        // matches as "projects" — the `|--` connector lives in a child <span> and is not folded in,
        // and the wrapper divs contribute no text of their own. One hit, no ambiguity.
        await userEvent.click(await canvas.findByText(/projects/))
        await waitFor(() => canvas.getByText(/Internship/))
    },
}

/** The open note's row, highlighted via the `activeFile` prop (accent fill + glow, and the icon
 *  takes the accent too). Declarative — `activeFile` is a real prop, so no interaction needed. */
export const ActiveFile: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return (
            <Sidebar>
                <FileTree
                    onOpen={noop}
                    activeFile="Housing.md"
                    startItemDrag={noop}
                    dropHighlight={noDrop}
                />
            </Sidebar>
        )
    },
}

/** Mid-drag: `dropHighlight` names the folder under the pointer, tinting that row. Also
 *  declarative — the prop is the drag controller's read seam (App's dnd/viewDrag), so a story can
 *  pose the state without simulating a pointer drag. */
export const DropTarget: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return (
            <Sidebar>
                <FileTree
                    onOpen={noop}
                    startItemDrag={noop}
                    dropHighlight={() => 'reading'}
                />
            </Sidebar>
        )
    },
}

/** Multi-select: three rows marked via Cmd-click, the state Delete and drag-many operate on.
 *  Like `open` and `editing`, the selection lives in an internal signal with no prop, so the story
 *  drives real clicks. `fireEvent.click` with `metaKey` is the route — `userEvent.click` would need
 *  a held-modifier sequence, and the component reads `e.metaKey || e.ctrlKey` straight off the
 *  event, so a plain synthetic click carrying the flag is exactly what a real Cmd-click delivers.
 *
 *  This story is the whole reason the `.ft-row.selected` rule now exists: the selection logic was
 *  already complete and correct, but nothing rendered it, so the feature looked broken. Without a
 *  story reaching this state the computed-style gate could never have told the difference between
 *  "selected rows are styled" and "selected rows are styled by nothing". */
export const MultiSelected: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return (
            <Sidebar>
                <FileTree
                    onOpen={noop}
                    activeFile="Housing.md"
                    startItemDrag={noop}
                    dropHighlight={noDrop}
                />
            </Sidebar>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // Budget and Housing are top-level files, so they need no folder expanded first. Housing is
        // also `activeFile`, which is the point: a row that is BOTH active and selected must still read
        // as active, and only a story holding both states at once can show that.
        fireEvent.click(await canvas.findByText(/Budget/), { metaKey: true })
        fireEvent.click(await canvas.findByText(/Housing/), { metaKey: true })
        await waitFor(() =>
            expect(
                canvasElement.querySelectorAll('[class*="selected"]').length,
            ).toBe(2),
        )
    },
}

/** Inline rename (`ft-edit-input`): the accent-bordered input sitting in place of a row's label.
 *  `editing` is an internal signal set only from the context menu, so the story takes the real
 *  route — right-click the row, then activate Rename. `fireEvent.contextMenu` carries explicit
 *  client coordinates because the menu positions itself from them; a synthesized right-click at
 *  0,0 would pin the menu to the viewport corner. */
export const Renaming: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        return (
            <Sidebar>
                <FileTree
                    onOpen={noop}
                    startItemDrag={noop}
                    dropHighlight={noDrop}
                />
            </Sidebar>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        fireEvent.contextMenu(await canvas.findByText(/Housing/), {
            clientX: 150,
            clientY: 120,
        })
        await userEvent.click(await canvas.findByText('Rename'))
        await waitFor(() => canvas.getByDisplayValue('Housing'))
    },
}

/** Regression cover for the row's drag-start guard (`Level`'s `onRowPointerDown` in FileTree.tsx):
 *  a press inside the OPEN rename input must place the caret, never start a row-drag of the note
 *  being renamed. The row starts a drag on `onPointerDown`, a different event from the `onClick`
 *  the input already stops — so the input declares the pointerdown as its own too (its own
 *  `onPointerDown` stops propagation), rather than the row DOM-matching a hashed class name to
 *  find out whether the press landed inside the input.
 *
 *  `startItemDrag` is the row's only drag entry point, so counting its calls is a direct proof.
 *  The first press (an ORDINARY, non-editing row) is a sanity check that the counter is wired to
 *  something real — without it, the zero-count assertion on the input press would pass even if
 *  `startItemDrag` were never wired up at all. */
export const RenameBlocksRowDrag: Story = {
    render: () => {
        setTransport(fakeTransport({ tree: TREE }))
        dragStarts = 0
        return (
            <Sidebar>
                <FileTree
                    onOpen={noop}
                    startItemDrag={() => {
                        dragStarts++
                    }}
                    dropHighlight={noDrop}
                />
            </Sidebar>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)

        // Sanity check: pressing an ordinary (non-editing) row DOES reach startItemDrag, so the
        // "unchanged" assertion below is proving something rather than trivially passing.
        fireEvent.pointerDown(await canvas.findByText(/Budget/), {
            button: 0,
        })
        await waitFor(() => expect(dragStarts).toBe(1))

        // Enter rename on Housing, same route as the Renaming story above.
        fireEvent.contextMenu(await canvas.findByText(/Housing/), {
            clientX: 150,
            clientY: 120,
        })
        await userEvent.click(await canvas.findByText('Rename'))
        const input = await canvas.findByDisplayValue('Housing')

        // A press placing the caret inside the open rename input must not register as a row-drag.
        fireEvent.pointerDown(input, { button: 0 })
        expect(dragStarts).toBe(1) // unchanged
    },
}
