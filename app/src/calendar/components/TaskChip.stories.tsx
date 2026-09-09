// Visual spec for <TaskChip> — the tasks-register calendar's single chip. Carried-or-not is
// the entire register: a chip that is NOT carried has no box at all and reads as ordinary
// text; a carried chip (late > 0) gets the danger wash + hairline + trailing "Nd late" chosen
// from rendered mockups (design doc, Part 2 — the tasks calendar). See TaskChip.module.css for
// why the register is a wash rather than a solid fill or a muted outline.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import TaskChip from './TaskChip'
import type { PlacedTask } from '../taskPlacement'
import { EMPTY_FILE } from '../../../../core/src/bases/types'

const meta = {
    title: 'Calendar/Components/TaskChip',
    component: TaskChip,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskChip>

export default meta
type Story = StoryObj<typeof meta>

function task(description: string, placed: string, late: number): PlacedTask {
    return {
        row: {
            file: { ...EMPTY_FILE, name: 'tasks', basename: 'tasks', path: 'tasks.md' },
            note: { description, placed, resolved: false },
            formula: {},
        },
        placed,
        late,
    }
}

/** A resolved task, carrying the RAW `statusChar` every real row has (taskToRow always sets
 *  it) — `x` for done, `-` for cancelled. `placeRows` never carries a resolved row forward
 *  (only unfinished ones roll onto today), so `late` is always 0 here. */
function resolvedTask(
    description: string,
    placed: string,
    statusChar: 'x' | '-',
): PlacedTask {
    return {
        row: {
            file: { ...EMPTY_FILE, name: 'tasks', basename: 'tasks', path: 'tasks.md' },
            note: { description, placed, resolved: true, statusChar },
            formula: {},
        },
        placed,
        late: 0,
    }
}

const cell = (children: JSX.Element) => (
    <div style={{ width: '220px', border: '1px solid var(--border)' }}>{children}</div>
)

/** Not carried — placed today or in the future. No box at all, reads as ordinary text. */
export const NotCarried: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task('email ana', '2026-09-09', 0)}
                onToggle={() => {}}
                onOpen={() => {}}
            />,
        ),
}

/** Carried by one day — the boundary case for the register: still gets the full wash +
 *  hairline + "1d late", not a lighter treatment for being only slightly overdue. */
export const CarriedOneDay: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task('pay rent', '2026-09-08', 1)}
                onToggle={() => {}}
                onOpen={() => {}}
            />,
        ),
}

/** Carried by many days — proves the register doesn't escalate visually with lateness; only
 *  the number in "Nd late" changes. */
export const CarriedManyDays: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task('renew passport', '2026-08-15', 25)}
                onToggle={() => {}}
                onOpen={() => {}}
            />,
        ),
}

/** A long description in a narrow cell must ellipsis rather than force the cell open — the
 *  title is the only flexible element in the chip's flex row. Carried, so the late suffix
 *  competes with the title for the same limited width. */
export const LongDescriptionEllipses: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task(
                    'follow up with the vendor about the delayed shipment before the weekend',
                    '2026-09-05',
                    4,
                )}
                onToggle={() => {}}
                onOpen={() => {}}
            />,
        ),
}

/** A DONE task on the calendar — history stays on the day it happened (`placeRows` never
 *  excludes resolved rows), so this chip must NOT read as still-open. Marker renders `[x]`,
 *  read straight off `note.statusChar` rather than derived from `resolved` alone. */
export const ResolvedDone: Story = {
    render: () =>
        cell(
            <TaskChip
                task={resolvedTask('renewed the lease', '2026-08-30', 'x')}
                onToggle={() => {}}
                onOpen={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        const marker = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-marker"]',
        )!
        expect(marker.textContent?.trim()).toBe('[x]')
    },
}

/** A CANCELLED task — the case a `resolved`-only marker would flatten into `[x]` (both done
 *  and cancelled are `resolved: true`; only `statusChar` tells them apart). Marker must read
 *  `[-]`, not `[x]`. */
export const ResolvedCancelled: Story = {
    render: () =>
        cell(
            <TaskChip
                task={resolvedTask('abandoned redesign', '2026-08-20', '-')}
                onToggle={() => {}}
                onOpen={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        const marker = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-marker"]',
        )!
        expect(marker.textContent?.trim()).toBe('[-]')
    },
}

/** Proves the chip's clicks are properly contained. Two separate `stopPropagation` calls
 *  guard two separate bugs, and this asserts both:
 *
 *  1. The chip's own ROOT DIV stops its click from reaching further up the tree. The
 *     calendar's day cell wires its own onClick to open the "create event" modal
 *     (MonthView.tsx), so an unstopped click would open a task's note AND that modal. The
 *     wrapping `ancestor` div below stands in for that day cell.
 *  2. The MARKER stops its own click from also reaching the chip's root div. Without that
 *     stop, clicking the marker still bubbles internally (it just never escapes to the
 *     ancestor, because the root div's own stop catches it one level up) and fires `onOpen`
 *     as well as `onToggle` — toggling a task would also open its note.
 *
 *  Provably testable, checked by hand while writing this story:
 *   - Commenting out the root div's `e.stopPropagation()` turned `data-bubbled` into "true"
 *     after clicking the title — FAIL.
 *   - Commenting out the marker's `e.stopPropagation()` left `data-bubbled` untouched (the
 *     root's own stop still contains it from the ancestor's point of view) but set
 *     `data-opened` after clicking the marker — FAIL, on the assertion added specifically to
 *     catch that. Both restored before committing. */
export const StopsPropagation: Story = {
    render: () => {
        let ancestor: HTMLDivElement | undefined
        return (
            <div
                ref={ancestor}
                data-testid="ancestor"
                onClick={() => ancestor?.setAttribute('data-bubbled', 'true')}
            >
                <TaskChip
                    task={task('do stuff', '2026-09-05', 4)}
                    onToggle={() => ancestor?.setAttribute('data-toggled', 'true')}
                    onOpen={() => ancestor?.setAttribute('data-opened', 'true')}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const ancestor = canvasElement.querySelector<HTMLElement>(
            '[data-testid="ancestor"]',
        )!
        const marker = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-marker"]',
        )!
        const title = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-title"]',
        )!

        // Clicking the chip body opens the task and must not reach the ancestor.
        await userEvent.click(title)
        expect(ancestor.getAttribute('data-opened')).toBe('true')
        expect(ancestor.getAttribute('data-bubbled')).toBeNull()
        ancestor.removeAttribute('data-opened')

        // Clicking the marker toggles the task, must not reach the ancestor, and — separately
        // — must NOT also open the task. That last check is what the marker's OWN stop
        // guards: without it, the click still bubbles to the chip's root div and fires
        // onOpen too, even though the ancestor never sees it.
        await userEvent.click(marker)
        expect(ancestor.getAttribute('data-toggled')).toBe('true')
        expect(ancestor.getAttribute('data-bubbled')).toBeNull()
        expect(ancestor.getAttribute('data-opened')).toBeNull()
    },
}
