// Visual spec for <TaskCellComposer> — the in-cell "add a task" composer. It must read as the
// task it is about to become: same marker/font/size as TaskChip, plus a `→ destination` line
// that truncates rather than growing the cell. See TaskChip.stories.tsx for the sibling spec
// this file's shape is modeled on.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import TaskCellComposer from './TaskCellComposer'
import TaskChip from './TaskChip'
import type { PlacedTask } from '../taskPlacement'
import { EMPTY_FILE } from '../../../../core/src/bases/types'

const meta = {
    title: 'Calendar/Components/TaskCellComposer',
    component: TaskCellComposer,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskCellComposer>

export default meta
type Story = StoryObj<typeof meta>

const cell = (width: string) => (children: import('solid-js').JSX.Element) => (
    <div style={{ width, border: '1px solid var(--border)' }}>{children}</div>
)

const monthCell = cell('220px')
const narrowCell = cell('120px')

function chipTask(description: string): PlacedTask {
    return {
        row: {
            file: { ...EMPTY_FILE, name: 'tasks', basename: 'tasks', path: 'tasks.md' },
            note: { description, placed: '2026-09-09', resolved: false },
            formula: {},
        },
        placed: '2026-09-09',
        late: 0,
    }
}

/** Freshly opened, nothing typed yet — proves the marker/input/destination layout on its own,
 *  before any interaction. */
export const Empty: Story = {
    render: () =>
        monthCell(
            <TaskCellComposer
                destination="General Tasks"
                onCommit={() => {}}
                onCancel={() => {}}
            />,
        ),
}

/** Types into the input and asserts the DOM value actually changed — not just that typing
 *  happened, but that the composer's own signal round-tripped back into the field. */
export const Typing: Story = {
    render: () =>
        monthCell(
            <TaskCellComposer
                destination="General Tasks"
                onCommit={() => {}}
                onCancel={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const input = canvas.getByTestId(
            'task-cell-composer-input',
        ) as HTMLInputElement
        await userEvent.type(input, 'water the plants')
        expect(input.value).toBe('water the plants')
    },
}

/** A destination deep enough to overflow the cell must truncate with an ellipsis rather than
 *  wrap onto a second line or force the composer wider than its column. */
export const LongDestination: Story = {
    render: () =>
        monthCell(
            <TaskCellComposer
                destination="Projects/Q4-Planning/Backlog-Items-Needing-Triage/General Tasks"
                onCommit={() => {}}
                onCancel={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const destination = canvas.getByTestId('task-cell-composer-destination')
        // (a) truncated — scrollWidth (the full text) exceeds what actually renders
        expect(destination.scrollWidth).toBeGreaterThan(destination.clientWidth)
        // (b) no wrap onto a second line — one line's worth of height only
        const lineHeight = parseFloat(getComputedStyle(destination).lineHeight)
        expect(destination.getBoundingClientRect().height).toBeLessThanOrEqual(
            lineHeight + 1,
        )
        // (c) the composer itself never grew past its 220px column
        const composer = destination.parentElement!
        const container = composer.parentElement!
        expect(composer.getBoundingClientRect().right).toBeLessThanOrEqual(
            container.getBoundingClientRect().right + 1,
        )
    },
}

/** The real case: a ~120px day column (the actual month-cell width), not the 220px cell used
 *  above. The `→ destination` line must truncate and the input must keep real, usable width —
 *  proof the destination line never pushes the input, only itself gives way. */
export const NarrowColumn: Story = {
    render: () =>
        narrowCell(
            <TaskCellComposer
                destination="Projects/Q4-Planning/Backlog-Items-Needing-Triage/General Tasks"
                onCommit={() => {}}
                onCancel={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const destination = canvas.getByTestId('task-cell-composer-destination')
        const input = canvas.getByTestId(
            'task-cell-composer-input',
        ) as HTMLInputElement

        // the destination line truncates rather than pushing the composer wider
        const composer = destination.parentElement!
        const container = composer.parentElement!
        expect(composer.getBoundingClientRect().right).toBeLessThanOrEqual(
            container.getBoundingClientRect().right + 1,
        )
        expect(destination.scrollWidth).toBeGreaterThan(destination.clientWidth)

        // the input still got real room — not squeezed to nothing by the marker + padding
        expect(input.getBoundingClientRect().width).toBeGreaterThan(40)
    },
}

/** The real layout: the composer opens as a sibling of TaskChip rows in the same day cell.
 *  Their `[ ]` markers must sit at the same left edge — .chip reserves
 *  `padding-inline-start: calc(var(--sp-3) + 3px)` for its category band, and .composer must
 *  mirror that exactly or its marker/text drift a few pixels left of the chips above it. */
export const AlignedWithChips: Story = {
    render: () =>
        monthCell(
            <div>
                <TaskChip
                    task={chipTask('email ana')}
                    onToggle={() => {}}
                    onOpen={() => {}}
                    onSetStatus={() => {}}
                />
                <TaskChip
                    task={chipTask('water the plants')}
                    color="var(--teal)"
                    onToggle={() => {}}
                    onOpen={() => {}}
                    onSetStatus={() => {}}
                />
                <TaskCellComposer
                    destination="General Tasks"
                    onCommit={() => {}}
                    onCancel={() => {}}
                />
            </div>,
        ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const chipMarkers = canvas.getAllByTestId('task-chip-marker')
        const composerMarker = canvas.getByTestId('task-cell-composer-marker')
        const composerLeft = composerMarker.getBoundingClientRect().left
        for (const marker of chipMarkers) {
            expect(marker.getBoundingClientRect().left).toBeCloseTo(composerLeft, 0)
        }
    },
}
