// Visual spec for <TaskEditModal> — the full editor a task's trailing pencil (TaskRow) or the
// calendar's task chip opens. Rows are built through the real producers (taskToRow /
// normalizeStoredTaskRow), same discipline as TaskRow.stories.tsx, so a hand-built fixture
// can't quietly drift from what the app actually passes in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TaskEditModal from './TaskEditModal'
import { setTransport, type Transport } from '../api'
import { toasts, dismissToast } from '../ui/toastStore'
import { fakeTransport } from '../ui/_fakeTransport'
import {
    taskToRow,
    normalizeStoredTaskRow,
} from '../../../core/src/bases/taskRow'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Task } from '../../../core/src/tasks'
import { removeTaskItem } from '../../../core/src/taskEdit'

const meta = {
    title: 'Bases/TaskEditModal',
    component: TaskEditModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TaskEditModal>

export default meta
type Story = StoryObj<typeof meta>

let closes = 0
let changes = 0
const onClose = () => {
    closes++
}
const onChanged = () => {
    changes++
}

type Call = { path: string; body: any }
let calls: Call[] = []

/** The in-memory transport, with every write recorded so `play()` can assert what was sent.
 *  `fail` rejects writes; `gate` holds them until it resolves (to observe the busy state). */
function recording(
    seed: Parameters<typeof fakeTransport>[0],
    opts: {
        fail?: boolean
        gate?: Promise<void>
        live?: Record<string, string>
    } = {},
): Transport {
    const base = fakeTransport(seed)
    const write = async (path: string, body: unknown) => {
        calls.push({ path, body })
        await opts.gate
        if (opts.fail) throw new Error('disk full')
    }
    return {
        ...base,
        post: async (path, body) => {
            await write(path, body)
            if (opts.live && path === '/tasks/delete') {
                const b = body as { path: string; line: number }
                opts.live[b.path] = removeTaskItem(
                    opts.live[b.path],
                    b.line,
                ).content
            }
            return base.post(path, body)
        },
        ...(opts.live
            ? {
                  getText: async (path: string) =>
                      opts.live![decodeURIComponent(path.split('path=')[1])],
                  put: async (_path: string, body: unknown) => {
                      const b = body as { path: string; contents: string }
                      calls.push({ path: '/file', body })
                      opts.live![b.path] = b.contents
                      return new Response('ok')
                  },
              }
            : {}),
        postJson: async <T,>(path: string, body: unknown) => {
            await write(path, body)
            if (path === '/tasks/move')
                return { path: (body as { to: string }).to } as unknown as T
            return base.postJson<T>(path, body)
        },
    }
}

function reset(): void {
    closes = 0
    changes = 0
    calls = []
    for (const t of toasts()) dismissToast(t.id)
}

/** A stored row that recurs weekly — ticking it done rewrites it and appends the next one. */
function recurringTask(): ReturnType<typeof normalizeStoredTaskRow> {
    return normalizeStoredTaskRow({
        file: syntheticBaseFile('boards/tasks.md'),
        note: {
            description: 'water the plants',
            status: 'todo',
            due: '2026-11-01',
            recurrence: 'every week',
        },
        formula: {},
        index: 1,
    })
}

/** A task SCANNED out of a note's checkbox line — carries `note.line`, so the modal offers a
 *  "note" destination picker instead of a category field. */
function lineTask(): ReturnType<typeof taskToRow> {
    return taskToRow({
        path: 'Projects/Website Relaunch.md',
        line: 3,
        indent: '',
        raw: '- [ ] finish the hero section [high] [due 2026-10-01]',
        status: 'todo',
        statusChar: ' ',
        description: 'finish the hero section',
        priority: 'high',
        due: '2026-10-01',
        tags: [],
    } as Task)
}

/** A task STORED as a YAML row in a base's own body — carries `index`, no `line`, so the modal
 *  offers a category field instead. */
function storedTask(): ReturnType<typeof normalizeStoredTaskRow> {
    return normalizeStoredTaskRow({
        file: syntheticBaseFile('boards/tasks.md'),
        note: {
            description: 'renew the domain',
            status: 'todo',
            priority: 'medium',
            category: 'Admin',
            due: '2026-11-01',
        },
        formula: {},
        index: 2,
    })
}

// Seeds the vault the "note" destination picker reads via api.tree() — with this, the current
// note (Projects/Website Relaunch.md) appears in the list and comes preselected, rather than
// the picker falling back to "not set" the way an unseeded fakeTransport would render it.
// The task sits at line 3 with a sub-task under it: undo must put back the exact block there.
const TASK_NOTE = 'Projects/Website Relaunch.md'
const TASK_NOTE_TEXT =
    '# Website Relaunch\n\n- [ ] intro\n- [/] finish the hero section [high] [due 2026-10-01]\n    - [ ] pick a font\n- [ ] outro\n'
let live: Record<string, string> = {}

const VAULT_FILES = {
    'Projects/Website Relaunch.md': '# Website Relaunch\n',
    'Areas/Health.md': '# Health\n',
    'Inbox.md': '# Inbox\n',
}

const body = () => within(document.body)

export const LineTask: Story = {
    render: () => {
        reset()
        setTransport(fakeTransport({ files: VAULT_FILES }))
        return <TaskEditModal row={lineTask()} onClose={onClose} />
    },
    play: async () => {
        // FormModal -> Modal portals its dialog to document.body, so query document.body.
        const canvas = body()
        expect(
            await canvas.findByDisplayValue('finish the hero section'),
        ).toBeInTheDocument()
        // A line task offers a "note" destination select, not a category field.
        expect(canvas.getByText('note')).toBeInTheDocument()
        expect(canvas.queryByText('category')).not.toBeInTheDocument()
        // The task's own note comes preselected in the destination picker.
        expect(await canvas.findByText('Website Relaunch')).toBeInTheDocument()
    },
}

export const StoredTaskWithCategories: Story = {
    render: () => {
        reset()
        setTransport(fakeTransport({}))
        return (
            <TaskEditModal
                row={storedTask()}
                categoryField="category"
                categories={['Admin', 'Home', 'Errands']}
                onClose={onClose}
            />
        )
    },
    play: async () => {
        const canvas = body()
        expect(
            await canvas.findByDisplayValue('renew the domain'),
        ).toBeInTheDocument()
        const category = canvas.getByDisplayValue('Admin')
        expect(category).toBeInTheDocument()
        // A stored row offers a category field, not a note destination select.
        expect(canvas.getByText('category')).toBeInTheDocument()
        expect(canvas.queryByText('note')).not.toBeInTheDocument()
        // Focusing the field offers the other categories (SuggestInput, not a datalist).
        await userEvent.clear(category)
        await userEvent.type(category, 'H')
        expect(await canvas.findByText('Home')).toBeInTheDocument()
    },
}

/** `destinations` supplied by the caller: the picker lists them by label, with the folder as
 *  detail, and the row's own note is preselected. */
export const Destinations: Story = {
    render: () => {
        reset()
        setTransport(fakeTransport({}))
        return (
            <TaskEditModal
                row={lineTask()}
                destinations={[
                    {
                        label: 'Website Relaunch',
                        path: 'Projects/Website Relaunch.md',
                    },
                    { label: 'Health', path: 'Areas/Health.md' },
                ]}
                onClose={onClose}
            />
        )
    },
    play: async () => {
        const canvas = body()
        await userEvent.click(await canvas.findByText('Website Relaunch'))
        expect(await canvas.findByText('Health')).toBeInTheDocument()
        expect(canvas.getByText('Areas')).toBeInTheDocument()
    },
}

/** Editing the description and pressing save writes ONLY the changed field, then closes. */
export const SaveWrites: Story = {
    render: () => {
        reset()
        setTransport(recording({ files: VAULT_FILES }))
        return (
            <TaskEditModal
                row={lineTask()}
                onChanged={onChanged}
                onClose={onClose}
            />
        )
    },
    play: async () => {
        const canvas = body()
        const input = await canvas.findByDisplayValue('finish the hero section')
        await userEvent.type(input, ' v2')
        await userEvent.click(canvas.getByText('save'))
        await waitFor(() => expect(closes).toBe(1))
        const writes = calls.filter(c => c.path === '/tasks/update')
        expect(writes.length).toBe(1)
        expect(writes[0].body.line).toBe(3)
        expect(writes[0].body.patch).toEqual({
            description: 'finish the hero section v2',
        })
        expect(changes).toBe(1)
    },
}

/** Enter in the description field saves, the same as the button. */
export const EnterToSave: Story = {
    render: () => {
        reset()
        setTransport(recording({ files: VAULT_FILES }))
        return <TaskEditModal row={lineTask()} onClose={onClose} />
    },
    play: async () => {
        const canvas = body()
        const input = await canvas.findByDisplayValue('finish the hero section')
        await userEvent.type(input, '!{Enter}')
        await waitFor(() => expect(closes).toBe(1))
        expect(
            calls.find(c => c.path === '/tasks/update')?.body.patch.description,
        ).toBe('finish the hero section!')
    },
}

let release: () => void = () => {}

/** While a write is in flight the save button reads "…" and is disabled, a second press writes
 *  nothing more, and the modal stays open until the write lands. */
export const Busy: Story = {
    render: () => {
        reset()
        const gate = new Promise<void>(r => {
            release = r
        })
        setTransport(recording({ files: VAULT_FILES }, { gate }))
        return <TaskEditModal row={lineTask()} onClose={onClose} />
    },
    play: async () => {
        const canvas = body()
        const input = await canvas.findByDisplayValue('finish the hero section')
        await userEvent.type(input, '!')
        await userEvent.click(canvas.getByText('save'))
        const busy = await canvas.findByText('…')
        expect(busy.closest('button')).toBeDisabled()
        await userEvent.type(input, '{Enter}')
        expect(calls.filter(c => c.path === '/tasks/update').length).toBe(1)
        expect(closes).toBe(0)
        release()
        await waitFor(() => expect(closes).toBe(1))
    },
}

/** A failed write keeps the modal open and raises an error toast. */
export const SaveError: Story = {
    render: () => {
        reset()
        setTransport(recording({ files: VAULT_FILES }, { fail: true }))
        return <TaskEditModal row={lineTask()} onClose={onClose} />
    },
    play: async () => {
        const canvas = body()
        const input = await canvas.findByDisplayValue('finish the hero section')
        await userEvent.type(input, '!')
        await userEvent.click(canvas.getByText('save'))
        await waitFor(() =>
            expect(toasts().map(t => t.message)).toContain(
                'Could not save the task: disk full',
            ),
        )
        expect(closes).toBe(0)
        expect(canvas.getByText('save').closest('button')).not.toBeDisabled()
    },
}

/** A stored, recurring row set to Done: the row is rewritten as done and the next occurrence
 *  is appended as a new row. */
export const StoredStatusRecurrence: Story = {
    render: () => {
        reset()
        setTransport(recording({}))
        return <TaskEditModal row={recurringTask()} onClose={onClose} />
    },
    play: async () => {
        const canvas = body()
        await userEvent.click(await canvas.findByText('To do'))
        await userEvent.click(await canvas.findByText('Done'))
        await userEvent.click(canvas.getByText('save'))
        await waitFor(() => expect(closes).toBe(1))
        const rows = calls.filter(c => c.path === '/row/update')
        expect(rows.length).toBe(2)
        expect(rows[0].body.index).toBe(1)
        expect(rows[0].body.note.status).toBe('done')
        expect(rows[1].body.index).toBeNull()
        expect(rows[1].body.note.status).toBe('todo')
    },
}

/** Delete is immediate: no confirm step. It writes, closes, and raises a "deleted …" toast
 *  whose undo puts the task back. */
export const DeleteThenUndo: Story = {
    render: () => {
        reset()
        live = { ...VAULT_FILES, [TASK_NOTE]: TASK_NOTE_TEXT }
        setTransport(recording({ files: VAULT_FILES }, { live }))
        return (
            <TaskEditModal
                row={lineTask()}
                onChanged={onChanged}
                onClose={onClose}
            />
        )
    },
    play: async () => {
        const canvas = body()
        await userEvent.click(await canvas.findByText('delete'))
        await waitFor(() => expect(closes).toBe(1))
        expect(calls.map(c => c.path)).toEqual(['/tasks/delete'])
        expect(canvas.queryByText('confirm delete')).not.toBeInTheDocument()
        const toast = toasts().find(
            t => t.message === 'deleted finish the hero section',
        )
        expect(toast?.action?.label).toBe('undo')
        expect(live[TASK_NOTE]).not.toContain('finish the hero section')
        toast!.action!.onClick()
        await waitFor(() => expect(live[TASK_NOTE]).toBe(TASK_NOTE_TEXT))
        expect(calls.map(c => c.path)).toEqual(['/tasks/delete', '/file'])
    },
}
