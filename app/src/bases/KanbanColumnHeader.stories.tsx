// Visual spec for <KanbanColumnHeader> — one column's title bar: StatusDot + ColorChip trigger,
// title or inline rename field, padded count, and the hover-revealed rename/delete bar. The
// interaction stories hold real state (createSignal), as KanbanView does around it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import KanbanColumnHeader, {
    type KanbanColumnHeaderProps,
} from './KanbanColumnHeader'

const PALETTE = [
    'var(--graph-0)',
    'var(--graph-1)',
    'var(--graph-2)',
    'var(--graph-3)',
    'var(--graph-4)',
]

const base: KanbanColumnHeaderProps = {
    columnKey: 'Doing',
    color: 'var(--graph-2)',
    hasOverride: false,
    palette: PALETTE,
    count: 2,
    editable: true,
    actions: true,
    renaming: false,
    existing: ['Todo', 'Done'],
    pickerOpen: false,
    onTogglePicker: () => {},
    onPickColor: () => {},
    onStartRename: () => {},
    onRename: () => {},
    onCancelRename: () => {},
    onDelete: () => {},
    onPointerDown: () => {},
}

const meta = {
    title: 'Bases/KanbanColumnHeader',
    component: KanbanColumnHeader,
    parameters: { layout: 'padded' },
    // The column carries the hue and the hover hook the header's CSS reads.
    decorators: [
        Story => (
            <div
                data-kbcol="Doing"
                style={{ '--kb-col-color': 'var(--graph-2)', width: '260px' }}
            >
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof KanbanColumnHeader>

export default meta
type Story = StoryObj<typeof meta>

/** An editable board's header at rest: dot, title, padded count. */
export const Default: Story = { args: base }

/** A read-only board (embedded query): the dot is a plain StatusDot, no picker, no actions. */
export const ReadOnly: Story = {
    args: { ...base, editable: false, actions: false },
}

/** The no-value lane: titled `(empty)`, renamable but with no delete. */
export const EmptyLane: Story = {
    args: { ...base, columnKey: '', count: 0 },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('(empty)')).toBeVisible()
        expect(canvas.getByLabelText('Rename column')).toBeInTheDocument()
        expect(canvas.queryByLabelText('Delete column')).toBeNull()
    },
}

/** Mid-rename: the title is swapped for the shared name field and the action bar is gone. */
export const Renaming: Story = {
    args: { ...base, renaming: true },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(await canvas.findByDisplayValue('Doing')).toBeVisible()
        expect(
            canvas.queryByRole('toolbar', { name: 'Column actions' }),
        ).toBeNull()
    },
}

/** The picker trigger sits over the dot: opening it lists the `auto` entry plus the 5 palette
 *  entries; picking one is handed back verbatim and the column's colour follows. State is real. */
export const PickColor: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        const [color, setColor] = createSignal<string | null>(null)
        return (
            <KanbanColumnHeader
                {...base}
                color={color() ?? 'var(--graph-2)'}
                hasOverride={color() !== null}
                pickerOpen={open()}
                onTogglePicker={() => setOpen(o => !o)}
                onPickColor={c => {
                    setColor(c)
                    setOpen(false)
                }}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)
        await userEvent.click(
            canvas.getByRole('button', { name: 'Choose colour' }),
        )
        const auto = await body.findByRole('button', { name: 'auto' })
        expect(auto).toHaveAttribute('aria-pressed', 'true')
        await userEvent.click(body.getByRole('button', { name: 'graph-1' }))
        await waitFor(() =>
            expect(body.queryByRole('button', { name: 'auto' })).toBeNull(),
        )
        await userEvent.click(
            canvas.getByRole('button', { name: 'Choose colour' }),
        )
        expect(
            await body.findByRole('button', { name: 'auto' }),
        ).toHaveAttribute('aria-pressed', 'false')
        expect(body.getByRole('button', { name: 'graph-1' })).toHaveAttribute(
            'aria-pressed',
            'true',
        )
    },
}
