// Visual spec for <AddRowAction> — the bar `[+]` button for table/list/bullets/cards views
// in normal mode (mirrors BaseView's own AddTaskAction, which covers `mode: tasks`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import AddRowAction from './AddRowAction'
import { sampleBaseConfig } from '../ui/_baseFixtures'

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
