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
// same pattern SheetView.stories.tsx and editor/InkOverlay.stories.tsx use. `tree` is a
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
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks'
import { FileTree } from './FileTree'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { settings, setSettings } from './settings'
import { SETTINGS_FILE } from './tabIds'
import type { TreeEntry } from '../../core/src/graph'
import type { NativeDragDetail } from './nativeDrop'

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

/** Captures every `uploadAsset(targetPath, bytes)` call for `NativeOsDropUpload` below — reset in
 *  that story's `render`, read in its `play`. */
let uploads: { target: string; bytes: ArrayBuffer }[] = []

/** Task 3: dropping OS files onto the tree (Tauri's native-drag path — `bismuth-native-drag`,
 *  nativeDrop.ts) uploads each into the folder under the cursor and skips anything the tree
 *  doesn't list. This is the ONLY story exercising `bismuth-native-drag` end to end (not just the
 *  drop-affordance highlight Terminal.stories.tsx covers): `@tauri-apps/plugin-fs`'s `readFile`
 *  calls the real Tauri IPC bridge, which throws outside an actual Tauri window — `mockIPC` (the
 *  package's own testing seam, `@tauri-apps/api/mocks`) intercepts `plugin:fs|read_file` so the
 *  real upload code path runs against fake bytes instead of a special test-only seam in FileTree
 *  itself. `isTauri()` is false in this browser tab either way, which is fine: nothing here reads
 *  it — the native-drag LISTENER is unconditional (the event just never fires in a real browser
 *  outside a test dispatching it by hand, exactly as Terminal.stories.tsx:208 already does). */
export const NativeOsDropUpload: Story = {
    render: () => {
        uploads = []
        setTransport(
            fakeTransport({
                tree: TREE,
                onUpload: (target, bytes) => {
                    uploads.push({ target, bytes })
                },
            }),
        )
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
        await canvas.findByText(/reading/)
        const row = canvasElement.querySelector('[data-drop-folder="reading"]')
        if (!(row instanceof HTMLElement))
            throw new Error('reading row (data-drop-folder) not found')
        const r = row.getBoundingClientRect()
        const point = { x: r.left + r.width / 2, y: r.top + r.height / 2 }

        mockIPC(cmd => {
            if (cmd !== 'plugin:fs|read_file') return null
            // A plain byte array — plugin-fs's readFile accepts either an ArrayBuffer or a
            // plain array from the (mocked) backend and wraps it in a Uint8Array either way.
            return Array.from(new TextEncoder().encode('fake-photo-bytes'))
        })
        try {
            const fire = (detail: NativeDragDetail) =>
                window.dispatchEvent(
                    new CustomEvent('bismuth-native-drag', { detail }),
                )
            fire({ type: 'enter', paths: [], ...point })
            fire({
                type: 'drop',
                paths: [
                    '/Users/x/Desktop/photo.png',
                    '/Users/x/Desktop/archive.zip',
                ],
                ...point,
            })

            await waitFor(() => expect(uploads.length).toBe(1))
            // Lands INSIDE the folder the cursor was over, keeping its own basename.
            expect(uploads[0].target).toBe('reading/photo.png')
            // Real bytes were read through the (mocked) fs plugin, not a stub/empty buffer.
            expect(uploads[0].bytes.byteLength).toBeGreaterThan(0)
            // The rejected .zip never reached uploadAsset at all.
            expect(uploads.some(u => u.target.includes('archive'))).toBe(false)
        } finally {
            clearMocks()
        }
    },
}


/** Task 7's #44 regression guard. CodeMirror's own `historyKeymap` sets `preventDefault` but not
 *  `stopPropagation` on Mod-z/Mod-Shift-z, so a REDO keystroke still bubbles to this window-level
 *  listener after CodeMirror has already handled it. Before the `matchesKeybinding` migration this
 *  listener matched Mod-Shift-Z too, because `.toLowerCase()` folds the shifted `"Z"` back to `"z"`
 *  regardless of Shift — silently eating the redo as a (usually no-op) "restore last deleted file"
 *  whenever focus wasn't on an editable element. `matchesKeybinding` matches modifiers EXACTLY, so
 *  `undo-delete`'s default `Mod+Z` does not match a `shiftKey: true` event — this story proves that
 *  by deleting a file and confirming Cmd+Shift+Z does NOT bring it back (only Cmd+Z, proven above,
 *  does). It fails against any implementation that folds Shift back into a bare key comparison. */
export const ShiftUndoDoesNotRestore: Story = {
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
        fireEvent.click(await canvas.findByText(/Housing/), { metaKey: true })
        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Delete',
                code: 'Delete',
                bubbles: true,
            }),
        )
        await waitFor(() => expect(canvas.queryByText(/Housing/)).toBeNull())

        // A real shifted Mod+Z reports an UPPERCASE key — faithfully reproduced here, not "Z" typed
        // as a stand-in for "shift held".
        window.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Z',
                code: 'KeyZ',
                metaKey: true,
                shiftKey: true,
                bubbles: true,
            }),
        )
        // No positive signal to await for a guard that must do nothing — give the (mocked, in-
        // memory) restore round trip, which resolves in a couple of microtasks, ample room to have
        // shown up if the guard had failed.
        await new Promise(r => setTimeout(r, 100))
        expect(canvas.queryByText(/Housing/)).toBeNull()
    },
}

/** Task 7: a rebind of `undo-delete` takes effect immediately (`FileTree` reads
 *  `settings.keybindings['undo-delete']` fresh on every keydown, never a value captured at mount)
 *  and the OLD combo stops working — the third acceptance case (a rebind "moves" the shortcut). */
export const RebindingUndoDeleteMovesIt: Story = {
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
        const restore = settings.keybindings['undo-delete']
        setSettings('keybindings', 'undo-delete', 'Mod+Shift+R')
        try {
            fireEvent.click(await canvas.findByText(/Housing/), {
                metaKey: true,
            })
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Delete',
                    code: 'Delete',
                    bubbles: true,
                }),
            )
            await waitFor(() => expect(canvas.queryByText(/Housing/)).toBeNull())

            // The OLD combo (Mod+Z) no longer restores.
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'z',
                    code: 'KeyZ',
                    metaKey: true,
                    bubbles: true,
                }),
            )
            await new Promise(r => setTimeout(r, 100))
            expect(canvas.queryByText(/Housing/)).toBeNull()

            // The NEW combo (Mod+Shift+R) does.
            window.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'r',
                    code: 'KeyR',
                    metaKey: true,
                    shiftKey: true,
                    bubbles: true,
                }),
            )
            await waitFor(() => canvas.getByText(/Housing/))
        } finally {
            // The settings store is module-level and shared by every story in the run.
            setSettings('keybindings', 'undo-delete', restore)
        }
    },
}

/** Task 7's acceptance case (1): the default `undo-delete` combo (Mod+Z) restores the last
 *  deleted file. Selection is established the same harness-supported way `MultiSelected` does —
 *  a Cmd-click, never a plain click. A plain click COLLAPSES any selection to a single active
 *  file with `selected().size === 0`, so the subsequent Delete becomes a silent no-op — exactly
 *  why the previous attempt at this story went red: nothing was ever deleted, so there was
 *  nothing on the undo stack for Mod+Z to restore. Deliberately one row, not `MultiSelected`'s
 *  two: `undoLastDelete` (FileTree.tsx) pops exactly ONE entry off the LIFO undo stack per
 *  keydown, so a two-row delete would need two Mod+Z presses to fully round-trip — asserting both
 *  rows back after a single dispatched keydown would test a press count this story never sends.
 *  The row's absence is asserted right after Delete, BEFORE Mod+Z runs at all, so a future no-op
 *  delete fails loudly here instead of being masked by an unrelated restore path.
 *
 *  `undo-delete` is pinned to its literal default ('Mod+Z') for the duration, same defensive
 *  shape `RebindingUndoDeleteMovesIt` already uses — `settings.ts` seeds the store by merging
 *  `readCache(SETTINGS_CACHE_KEY)` (an actual browser `localStorage` blob) over DEFAULTS, and
 *  that storage persists across every story and every `verify` run against this same long-lived
 *  Storybook tab. Assuming the ambient binding was still the shipped default (rather than pinning
 *  it) is exactly the kind of unchecked assumption this story exists to avoid. */
export const UndoDeleteRestoresFile: Story = {
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
        const restore = settings.keybindings['undo-delete']
        setSettings('keybindings', 'undo-delete', 'Mod+Z')
        try {
            fireEvent.click(await canvas.findByText(/Housing/), {
                metaKey: true,
            })
            // Confirm the selection actually landed before relying on it — the whole prior
            // failure was an assumption exactly like this one going unchecked.
            await waitFor(() =>
                expect(
                    canvasElement.querySelectorAll('[class*="selected"]')
                        .length,
                ).toBe(1),
            )

            // `onKey` lives on `window`, but it is a real keydown listener, not a synthetic-only
            // seam — focus a row first so the event bubbles up to it the way a real keypress
            // would, rather than firing on `window` itself.
            const row = canvasElement.querySelector<HTMLElement>('[data-ft-path]')!
            row.focus()

            row.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'Delete',
                    code: 'Delete',
                    bubbles: true,
                    cancelable: true,
                }),
            )
            // The intermediate state: the delete actually happened, proven before undo is
            // even tried. The measured round trip runs ~1.8s under load, so give it real room.
            await waitFor(
                () => expect(canvas.queryByText(/Housing/)).toBeNull(),
                { timeout: 3000 },
            )

            row.dispatchEvent(
                new KeyboardEvent('keydown', {
                    key: 'z',
                    code: 'KeyZ',
                    metaKey: true,
                    bubbles: true,
                    cancelable: true,
                }),
            )
            // Measured restore round trip runs ~2.5s under load.
            await waitFor(() => canvas.getByText(/Housing/), { timeout: 4000 })
        } finally {
            setSettings('keybindings', 'undo-delete', restore)
        }
    },
}
