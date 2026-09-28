// Visual spec for <TaskEditModal> — the full editor a task's trailing pencil (TaskRow) or the
// calendar's task chip opens. Rows are built through the real producers (taskToRow /
// normalizeStoredTaskRow), same discipline as TaskRow.stories.tsx, so a hand-built fixture
// can't quietly drift from what the app actually passes in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import TaskEditModal from './TaskEditModal'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import {
    taskToRow,
    normalizeStoredTaskRow,
} from '../../../core/src/bases/taskRow'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Task } from '../../../core/src/tasks'

const meta = {
    title: 'Bases/TaskEditModal',
    component: TaskEditModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TaskEditModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

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
const VAULT_FILES = {
    'Projects/Website Relaunch.md': '# Website Relaunch\n',
    'Areas/Health.md': '# Health\n',
    'Inbox.md': '# Inbox\n',
}

export const LineTask: Story = {
    render: () => {
        setTransport(fakeTransport({ files: VAULT_FILES }))
        return <TaskEditModal row={lineTask()} onClose={noop} />
    },
    play: async () => {
        // FormModal -> Modal portals its dialog to document.body (ui/Modal.tsx), so it never
        // lands inside canvasElement — query document.body instead, same as
        // TaskCalendarSettings.stories.tsx does for the identical reason.
        const canvas = within(document.body)
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
        setTransport(fakeTransport({}))
        return (
            <TaskEditModal
                row={storedTask()}
                categoryField="category"
                categories={['Admin', 'Home', 'Errands']}
                onClose={noop}
            />
        )
    },
    play: async () => {
        const canvas = within(document.body)
        expect(
            await canvas.findByDisplayValue('renew the domain'),
        ).toBeInTheDocument()
        expect(canvas.getByDisplayValue('Admin')).toBeInTheDocument()
        // A stored row offers a category field, not a note destination select.
        expect(canvas.getByText('category')).toBeInTheDocument()
        expect(canvas.queryByText('note')).not.toBeInTheDocument()
    },
}

/** The delete footer's inline two-step confirm: "[ delete ]" arms into "[ confirm delete ] [
 *  cancel ]" rather than a browser confirm() dialog — the daemon rows' own idiom
 *  (DaemonCrons.tsx), reused here rather than inventing a modal-on-a-modal. */
export const DeleteConfirm: Story = {
    render: () => {
        setTransport(fakeTransport({ files: VAULT_FILES }))
        return <TaskEditModal row={lineTask()} onClose={noop} />
    },
    play: async () => {
        const canvas = within(document.body)
        const deleteBtn = await canvas.findByText('delete')
        await userEvent.click(deleteBtn)
        expect(await canvas.findByText('confirm delete')).toBeInTheDocument()
        // "keep" (not a second "cancel") disarms — the footer's own trailing "cancel" still
        // closes the whole modal, so two buttons both reading "cancel" side by side would be
        // ambiguous about which one they dismiss.
        expect(canvas.getByText('keep')).toBeInTheDocument()
        expect(canvas.getAllByText('cancel').length).toBe(1)
        // The original single "delete" trigger is gone while armed.
        expect(
            canvas.queryByText('delete', { exact: true }),
        ).not.toBeInTheDocument()
    },
}
