// Visual spec for <AddRowAction> — the bar `[+]` button for table/list/bullets/cards views
// in normal mode (mirrors BaseView's own AddTaskAction, which covers `mode: tasks`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { onCleanup } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import { BaseView } from './BaseView'
import { setTransport } from '../api'
import { disarmFakeServerVersion, fakeTransport } from '../ui/_fakeTransport'
import AddRowAction from './AddRowAction'
import { SAMPLE_ROWS, sampleBaseConfig } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/AddRowAction',
    component: AddRowAction,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof AddRowAction>

export default meta
type Story = StoryObj<typeof meta>

const VIEW = { type: 'table' as const, name: 'Table' }

/** A basePath is set and the view is a row view in normal mode — the button renders. */
export const Default: Story = {
    render: () => (
        <AddRowAction
            basePath="boards/books.md"
            config={sampleBaseConfig()}
            view={VIEW}
            viewIndex={0}
            ownsRows={false}
            mode="normal"
            onAdded={() => {}}
        />
    ),
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')
        expect(btn).toBeTruthy()
    },
}

/** No `basePath` (an embedded ```query block, or a story with no base of its own) — no
 *  create action, same as KanbanView's `editable()` gate. The caption is rendered alongside so
 *  the story isn't a bare empty canvas — the absence of a button is the thing under test, not
 *  the absence of anything painting at all. */
export const NoBasePath: Story = {
    render: () => (
        <div>
            <p>no basePath — no `[+]` button renders below:</p>
            <AddRowAction
                config={sampleBaseConfig()}
                view={VIEW}
                viewIndex={0}
                ownsRows={false}
                mode="normal"
                onAdded={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('button')).toBeNull()
    },
}

/** Tasks mode renders nothing — BaseView's AddTaskAction covers task creation. */
export const TasksModeHidden: Story = {
    render: () => (
        <div>
            <p>
                mode: tasks — no `[+]` button renders below (AddTaskAction
                covers it):
            </p>
            <AddRowAction
                basePath="boards/books.md"
                config={sampleBaseConfig()}
                view={VIEW}
                viewIndex={0}
                ownsRows={false}
                mode="tasks"
                onAdded={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('button')).toBeNull()
    },
}

const NOTES_PATH = 'boards/reading.md'
// `source: notes` is declared, so the base does NOT own its rows: a new row is a fresh note.
const NOTES_BODY =
    '---\ntype: base\nsource:\n  kind: notes\nviews:\n  - type: table\n---\n'

// Notes living beside the base: the fake vault files a fresh note in the base's own folder, so
// only rows in that folder can pick it up on the next resolve.
const BOARD_ROWS = SAMPLE_ROWS.slice(0, 3).map(r => ({
    ...r,
    file: { ...r.file, folder: 'boards', path: `boards/${r.file.name}.md` },
}))

function NotesBase() {
    // A versioned transport answers like the wire: the write lands, the version bumps, and the
    // refetch BaseView runs resolves the vault again with the new note in it.
    setTransport(
        fakeTransport({
            versioned: true,
            rows: BOARD_ROWS,
            files: { [NOTES_PATH]: NOTES_BODY },
        }),
    )
    onCleanup(disarmFakeServerVersion)
    return <BaseView path={NOTES_PATH} body={NOTES_BODY} />
}

/** The real flow: click `[+]` in a notes-sourced base's bar and one more row appears in the
 *  table. The story holds real state (a versioned fake transport), so the count proves the note
 *  was written and the view refetched — not that a callback was called. */
export const NewRowAppears: Story = {
    render: () => <NotesBase />,
    play: async ({ canvasElement }) => {
        const rows = () => canvasElement.querySelectorAll('tbody tr').length
        await waitFor(() => expect(rows()).toBeGreaterThanOrEqual(BOARD_ROWS.length))
        const before = rows()
        await userEvent.click(
            canvasElement.querySelector<HTMLElement>('button[aria-label="New row"]')!,
        )
        await waitFor(() => expect(rows()).toBeGreaterThan(before))
    },
}
