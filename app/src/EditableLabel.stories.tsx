// Visual + behavioral spec for <EditableLabel> — the inline-rename input the file tree (and
// EditableLabel.tsx's own extraction from FileTree.tsx) swaps in for a row's label. Extracted
// from FileTree.stories.tsx's `Renaming`/`RenameBlocksRowDrag` coverage, which drove this same
// input indirectly through the tree; these stories drive it directly, since it needs no `/tree`
// fetch or fakeTransport tree seed of its own.
//
// FIXTURE SEAM: `commit()` still calls the real `api.move`, so a story that exercises it needs
// `setTransport(fakeTransport(...))` — the default fake acks every mutation with a plain 200, which
// covers the success path for free. The failure story below wraps that fake with a `post` override
// that rejects `/move` specifically, mirroring how the real `httpTransport` throws on a non-2xx.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import { EditableLabel } from './EditableLabel'
import { setTransport, type Transport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import type { TreeNode } from './fileTreeModel'

const noop = () => {}
const noopAsync = async () => {}
const passThrough = <T,>(fn: () => Promise<T>) => fn()

/** Records every `bismuth-moved` event dispatched during `RenameFailureRevertsTab` below — reset
 *  in that story's `render`, read in its `play`. A module-level binding rather than a Storybook
 *  `fn()` mock, matching FileTree.stories.tsx's `dragStarts` counter for the same reason: both
 *  closures just need one shared place to record into. */
let movedEvents: Array<{ from: string; to: string }> = []

const FILE_NODE: TreeNode = { name: 'Housing.md', path: 'Housing.md' }
const DIR_NODE: TreeNode = { name: 'projects', path: 'projects' }

const meta = {
    title: 'App/EditableLabel',
    component: EditableLabel,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof EditableLabel>

export default meta
type Story = StoryObj<typeof meta>

/** A file row mid-rename: the input shows the extension-STRIPPED stem ("Housing", not
 *  "Housing.md") and is auto-focused + fully selected on mount, so typing immediately replaces
 *  the whole name — the same behavior FileTree.stories.tsx's `Renaming` story proved indirectly
 *  via the context menu. */
export const Default: Story = {
    render: () => {
        setTransport(fakeTransport())
        return (
            <EditableLabel
                node={FILE_NODE}
                isDir={false}
                setEditing={noop}
                refresh={noop}
                optimisticRename={noop}
                trackPending={passThrough}
                awaitCreate={noopAsync}
                onSettled={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = await canvas.findByDisplayValue('Housing')
        await waitFor(() => expect(document.activeElement).toBe(input))
    },
}

/** A folder row mid-rename: dirs have no hidden extension to strip, so the input shows the
 *  name in full ("projects", not a stem+ext split). */
export const FolderRename: Story = {
    render: () => {
        setTransport(fakeTransport())
        return (
            <EditableLabel
                node={DIR_NODE}
                isDir={true}
                setEditing={noop}
                refresh={noop}
                optimisticRename={noop}
                trackPending={passThrough}
                awaitCreate={noopAsync}
                onSettled={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await canvas.findByDisplayValue('projects')
    },
}

/** Regression cover for the "double extension" bug: renaming a `.yaml` file to a name that
 *  already ends in a DIFFERENT recognized hidden extension (`.yml`) must swap it, not append the
 *  original on top (`config.yml.yaml`). `optimisticRename`'s captured `to` argument is the only
 *  place the computed name is observable, since the input itself always shows the stem. */
export const ExtensionSwap: Story = {
    render: () => {
        setTransport(fakeTransport())
        let to = ''
        return (
            <div>
                <EditableLabel
                    node={{ name: 'config.yaml', path: 'config.yaml' }}
                    isDir={false}
                    setEditing={noop}
                    refresh={noop}
                    optimisticRename={(_from, t) => {
                        to = t
                    }}
                    trackPending={passThrough}
                    awaitCreate={noopAsync}
                    onSettled={() => {
                        // Surface the captured `to` in the DOM so `play` can assert on it without
                        // reaching into the closure directly.
                        const out = document.querySelector(
                            '[data-testid="settled-to"]',
                        )
                        if (out) out.textContent = to
                    }}
                />
                <output data-testid="settled-to" />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = await canvas.findByDisplayValue('config')
        fireEvent.input(input, { target: { value: 'config.yml' } })
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="settled-to"]')
                    ?.textContent,
            ).toBe('config.yml'),
        )
    },
}

/** Regression cover for a failed move leaving the tab stranded on a path that was never
 *  created: `commit()` must dispatch the INVERSE `bismuth-moved` event (`{from: to, to: from}`)
 *  before reverting, so any pane retargeted to the not-yet-existent `to` gets pointed back at
 *  `from`. This wraps the default fake transport with a `post` that rejects `/move` specifically
 *  (mirroring how the real `httpTransport` throws on a non-2xx response) and records every
 *  `bismuth-moved` event dispatched during the commit. */
export const RenameFailureRevertsTab: Story = {
    render: () => {
        const base = fakeTransport()
        const failingMove: Transport = {
            ...base,
            post: async (path, body) => {
                if (path === '/move') throw new Error('EEXIST')
                return base.post(path, body)
            },
        }
        setTransport(failingMove)
        movedEvents = []
        window.addEventListener('bismuth-moved', e => {
            movedEvents.push((e as CustomEvent).detail)
        })
        return (
            <EditableLabel
                node={FILE_NODE}
                isDir={false}
                setEditing={noop}
                refresh={noop}
                optimisticRename={noop}
                trackPending={passThrough}
                awaitCreate={noopAsync}
                onSettled={noop}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = await canvas.findByDisplayValue('Housing')
        fireEvent.input(input, { target: { value: 'Renamed' } })
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(movedEvents).toEqual([
                { from: 'Housing.md', to: 'Renamed.md' },
                { from: 'Renamed.md', to: 'Housing.md' },
            ]),
        )
    },
}
