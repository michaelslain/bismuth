// Visual spec for <KanbanColumn> — one lane: header, its cards, the drop-gap placeholder and the
// add-card composer. Cards come from the shared board fixture run through the real query engine;
// the composer story holds real state (createSignal) and asserts the add it dispatches.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import KanbanColumn, { type KanbanColumnProps } from './KanbanColumn'
import { rowId } from './rowIdentity'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { kanbanView } from '../ui/_kanbanProbes'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'

const view = kanbanView()
const result = sampleViewResult(undefined, { view })
const config = sampleBaseConfig({ view })
const todo = result.groups.find(g => g.key === 'Todo')!
const rowsById = new Map(todo.rows.map(r => [rowId(r), r]))

const base: KanbanColumnProps = {
    columnKey: 'Todo',
    color: 'var(--graph-1)',
    hasOverride: false,
    palette: [
        'var(--graph-0)',
        'var(--graph-1)',
        'var(--graph-2)',
        'var(--graph-3)',
        'var(--graph-4)',
    ],
    count: todo.rows.length,
    editable: true,
    actions: true,
    renaming: false,
    existing: ['Doing', 'Done'],
    pickerOpen: false,
    onTogglePicker: () => {},
    onPickColor: () => {},
    onStartRename: () => {},
    onRename: () => {},
    onCancelRename: () => {},
    onDelete: () => {},
    onPointerDown: () => {},
    hovered: false,
    onHover: () => {},
    over: false,
    reorderTarget: false,
    dragging: false,
    last: false,
    ids: [...rowsById.keys()],
    rowById: id => rowsById.get(id),
    overIndex: null,
    tasks: false,
    config,
    titleCol: 'file.name',
    metaCols: ['priority', 'tags'],
    hideLabels: false,
    cardsEditable: true,
    dropCardId: null,
    onCardPointerDown: () => {},
    onFileDragOver: () => {},
    onFileDragLeave: () => {},
    onFileDrop: () => {},
    onRenameCard: async row => row.file.path,
    onSetMeta: () => {},
    onDeleteCard: () => {},
    siblingValues: () => [],
    canAdd: true,
    composing: false,
    draft: '',
    onDraft: () => {},
    onOpenComposer: () => {},
    onCloseComposer: () => {},
    onAddCard: async () => {},
}

const meta = {
    title: 'Bases/KanbanColumn',
    component: KanbanColumn,
    parameters: { layout: 'padded' },
    decorators: [
        Story => {
            setTransport(fakeTransport())
            return (
                <div
                    style={{ display: 'flex', height: '420px', width: '300px' }}
                >
                    <Story />
                </div>
            )
        },
    ],
} satisfies Meta<typeof KanbanColumn>

export default meta
type Story = StoryObj<typeof meta>

/** A lane with its cards, the colour underline and the `add a card` affordance. */
export const Default: Story = { args: base }

/** A card is being dragged over this lane: the wash, and the open drop slot above card 1. */
export const DropTarget: Story = { args: { ...base, over: true, overIndex: 1 } }

/** No cards: just the header and the add affordance. */
export const Empty: Story = {
    args: { ...base, ids: [], count: 0, overIndex: null },
}

/** Read-only board: no colour picker, no action bar, no add-card `+`. */
export const ReadOnly: Story = {
    args: {
        ...base,
        editable: false,
        actions: false,
        canAdd: false,
        cardsEditable: false,
    },
}

/** The composer holds real state: opening it, typing and pressing Enter dispatches the add with
 *  the typed title; Escape closes it. */
export const AddCard: Story = {
    render: () => {
        const [composing, setComposing] = createSignal(false)
        const [draft, setDraft] = createSignal('')
        const [added, setAdded] = createSignal<string[]>([])
        return (
            <div data-added={added().join('|')}>
                <KanbanColumn
                    {...base}
                    composing={composing()}
                    draft={draft()}
                    onDraft={setDraft}
                    onOpenComposer={() => setComposing(true)}
                    onCloseComposer={() => {
                        setComposing(false)
                        setDraft('')
                    }}
                    onAddCard={async () => {
                        setAdded(a => [...a, draft().trim()])
                        setDraft('')
                    }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByLabelText('Add a card'))
        const input = await canvas.findByPlaceholderText(/card title/i)
        await userEvent.type(input, 'write the docs')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(canvasElement.querySelector('[data-added]')).toHaveAttribute(
                'data-added',
                'write the docs',
            ),
        )
        await userEvent.keyboard('{Escape}')
        await waitFor(() =>
            expect(canvas.getByLabelText('Add a card')).toBeVisible(),
        )
    },
}
