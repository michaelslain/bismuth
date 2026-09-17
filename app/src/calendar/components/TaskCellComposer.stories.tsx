// Visual spec for <TaskCellComposer> — the in-cell "add a task" composer. It must read as the
// task it is about to become: same marker/font/size as TaskChip, plus a `→ destination` line
// that truncates rather than growing the cell. See TaskChip.stories.tsx for the sibling spec
// this file's shape is modeled on.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, within } from 'storybook/test'
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

/** No destination configured — `CalendarView.tsx`'s `destination()` returns `''` when a
 *  sourced view has no `taskFile` set yet. The old unconditional `→ {props.destination}` read
 *  as a bare `→` with nothing after it, a stray character under the caret — worse, the
 *  composer still opened and still accepted typing, and the failure only arrived after Enter as
 *  a toast. This proves the line now reads as an explicit hint instead, in place, with the
 *  composer still open and usable. */
export const NoDestination: Story = {
    render: () =>
        monthCell(
            <TaskCellComposer destination="" onCommit={() => {}} onCancel={() => {}} />,
        ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const destination = canvas.getByTestId('task-cell-composer-destination')
        expect(destination.textContent?.trim()).toBe(
            '→ no destination note // set one in settings',
        )
        // The composer stays open and usable — this is a hint in place, not a refusal to open.
        expect(
            canvas.getByTestId('task-cell-composer-input'),
        ).not.toBeDisabled()
    },
}

/** The composer previews the category a commit will actually carry — `CalendarView.tsx` passes
 *  the resolved colour of the view's `defaultCategory` through `TaskComposeProps.color`, and it
 *  paints straight onto the `[ ]` marker's text colour, matching `TaskChip`'s own marker. */
export const WithCategoryColour: Story = {
    render: () =>
        monthCell(
            <TaskCellComposer
                destination="General Tasks"
                color="var(--teal)"
                onCommit={() => {}}
                onCancel={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const marker = canvas.getByTestId('task-cell-composer-marker')
        expect(marker.style.color).toBe('var(--teal)')
    },
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

/** A destination NAME long enough to overflow the cell must truncate at the tail with an
 *  ellipsis rather than wrap onto a second line or force the composer wider than its column.
 *  `CalendarView.tsx`'s `destination()` always passes a basename (`fileBasename`), never a
 *  path — this fixture used to be a long path, a case the component's contract forbids and the
 *  app never actually produces. A long single name (a verbose note title) is the real case:
 *  the tail is the part that identifies it, so truncating there is correct. */
export const LongDestination: Story = {
    render: () =>
        monthCell(
            <TaskCellComposer
                destination="Q4 Planning Backlog and Intake Items Needing Immediate Triage"
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
 *  proof the destination line never pushes the input, only itself gives way. Same long-basename
 *  fixture as LongDestination — see that story's note on why this is never a path. */
export const NarrowColumn: Story = {
    render: () =>
        narrowCell(
            <TaskCellComposer
                destination="Q4 Planning Backlog and Intake Items Needing Immediate Triage"
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
 *  Their `[ ]` markers must sit at the same left edge — neither .chip nor .composer reserves a
 *  band gutter any more, so both share the plain `.row`/`.marker` padding and line up whether or
 *  not either one carries a colour. One chip here carries a `color`, the other does not, proving
 *  the alignment holds either way — a coloured marker is still the same box, just painted. */
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

/** [Important finding] `CalendarView.tsx`'s `commitTask` no longer closes the composer after a
 *  write (that's the fix restoring acceptance #4 — Enter writes and leaves the composer open
 *  and empty). Blur must match the Enter path exactly: commit, then clear. A blur that commits
 *  but leaves the typed text sitting in the input means clicking back in and pressing Enter
 *  writes the same task a second time — this proves the input is actually emptied, not just
 *  that onCommit fired. */
export const BlurCommitsThenClears: Story = {
    render: () => {
        const calls: string[] = []
        ;(window as unknown as { __blurCalls?: string[] }).__blurCalls = calls
        return monthCell(
            <TaskCellComposer
                destination="General Tasks"
                onCommit={text => calls.push(text)}
                onCancel={() => calls.push('cancel')}
            />,
        )
    },
    play: async ({ canvasElement }) => {
        const calls = (window as unknown as { __blurCalls: string[] }).__blurCalls
        const canvas = within(canvasElement)
        const input = canvas.getByTestId(
            'task-cell-composer-input',
        ) as HTMLInputElement

        await userEvent.type(input, 'water the plants')
        fireEvent.blur(input)

        expect(calls).toEqual(['water the plants'])
        // The finding: blur committed but left the just-written text sitting in the input,
        // inviting a duplicate write on the next Enter.
        expect(input.value).toBe('')
    },
}

/** [Important finding] a sourced calendar with no `taskFile` set (a new task calendar's
 *  first-run state) has `destination === ''` — the same state that drives the composer's own
 *  `--danger` "no destination note // set one in settings" hint below the input.
 *  `CalendarView.tsx`'s `commitTask` writes nothing for that state; it opens settings instead.
 *  Enter used to clear the input unconditionally regardless, throwing away what the user typed
 *  with nowhere for it to have gone. Proves the draft survives Enter when there is no
 *  destination to write it to. */
export const EnterKeepsDraftWithNoDestination: Story = {
    render: () => {
        const calls: string[] = []
        ;(window as unknown as { __noDestCalls?: string[] }).__noDestCalls = calls
        return monthCell(
            <TaskCellComposer
                destination=""
                onCommit={text => calls.push(text)}
                onCancel={() => calls.push('cancel')}
            />,
        )
    },
    play: async ({ canvasElement }) => {
        const calls = (window as unknown as { __noDestCalls: string[] }).__noDestCalls
        const canvas = within(canvasElement)
        const input = canvas.getByTestId(
            'task-cell-composer-input',
        ) as HTMLInputElement

        await userEvent.type(input, 'water the plants')
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )

        expect(calls).toEqual(['water the plants'])
        // The finding: Enter cleared the input even though commitTask writes nothing when
        // there's no destination, throwing the typed task away.
        expect(input.value).toBe('water the plants')
    },
}
