// Visual spec for <TaskChip> — the tasks-register calendar's single chip. Carried-or-not is
// the entire register: a chip that is NOT carried has no box at all and reads as ordinary
// text; a carried chip (late > 0) gets the danger wash + hairline + trailing "Nd late" chosen
// from rendered mockups (design doc, Part 2 — the tasks calendar). See TaskChip.module.css for
// why the register is a wash rather than a solid fill or a muted outline.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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

function task(
    description: string,
    placed: string,
    late: number,
    opts?: { line?: number; field?: string },
): PlacedTask {
    return {
        row: {
            file: { ...EMPTY_FILE, name: 'tasks', basename: 'tasks', path: 'tasks.md' },
            note: { description, placed, resolved: false, line: opts?.line },
            formula: {},
        },
        placed,
        late,
        field: opts?.field,
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
                onSetStatus={() => {}}
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
                onSetStatus={() => {}}
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
                onSetStatus={() => {}}
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
                onSetStatus={() => {}}
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
                onSetStatus={() => {}}
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
                onSetStatus={() => {}}
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
 *     catch that. Both restored before committing.
 *
 *  Needs `line`/`field` (i.e. `isTaskLine` true) — this is testing the TOGGLE path, so the
 *  task must be writable, or the marker's click falls through to `onOpen` instead (see
 *  `MarkerNotInteractiveForSelfOwnedRow` below for that other case). */
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
                    task={task('do stuff', '2026-09-05', 4, { line: 2, field: 'due' })}
                    onToggle={() => ancestor?.setAttribute('data-toggled', 'true')}
                    onOpen={() => ancestor?.setAttribute('data-opened', 'true')}
                    onSetStatus={() => {}}
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

/** Right-click the marker opens the shared status menu (taskStatusMenu.tsx) with the CURRENT
 *  status filtered out, and picking a row calls `onSetStatus` with the chosen box char — the
 *  same wiring `ListView.tsx` uses for the same menu. The menu portals straight to
 *  `document.body` (see taskStatusMenu.stories.tsx), so this asserts against `document.body`,
 *  not `canvasElement`. Needs `line`/`field` — a writable (sourced) task, see
 *  `MarkerNotInteractiveForSelfOwnedRow` for the other case. */
export const RightClickOpensStatusMenu: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task('buy milk', '2026-09-09', 0, { line: 5, field: 'scheduled' })}
                onToggle={() => {}}
                onOpen={() => {}}
                onSetStatus={char =>
                    ((window as unknown as { __picked?: string }).__picked = char)
                }
            />,
        ),
    play: async ({ canvasElement }) => {
        delete (window as unknown as { __picked?: string }).__picked
        const marker = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-marker"]',
        )!
        // userEvent has no native "right click" — a contextmenu event is what the browser
        // fires for one, and it's what the marker's own onContextMenu listens for.
        marker.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 40,
                clientY: 40,
            }),
        )
        const body = within(document.body)
        const done = await waitFor(() => body.getByText('Done'))
        // "To do" (the CURRENT status, ' ') must be filtered out of the menu.
        expect(body.queryByText('To do')).not.toBeInTheDocument()
        done.click()
        await waitFor(() =>
            expect(
                (window as unknown as { __picked?: string }).__picked,
            ).toBe('x'),
        )
    },
}

/** `draggable` gates on `isTaskLine` (taskPlacement.ts) — whether the row resolves BOTH a real
 *  markdown line (`note.line`) and a placement field — a self-owned base row (no `source:`, so
 *  no `line`) has neither and must not be draggable, since there is no "source markdown line"
 *  for a drop to rewrite. The SAME predicate also gates the marker's toggle/status-menu — see
 *  `MarkerNotInteractiveForSelfOwnedRow`/`MarkerInteractiveForSourcedRow` below, which prove
 *  that behaviorally (by clicking) rather than by reading an attribute. */
export const DraggableOnlyWhenSourced: Story = {
    render: () =>
        cell(
            <>
                <TaskChip
                    task={task('sourced task', '2026-09-09', 0, {
                        line: 3,
                        field: 'scheduled',
                    })}
                    onToggle={() => {}}
                    onOpen={() => {}}
                    onSetStatus={() => {}}
                />
                <TaskChip
                    task={task('self-owned row', '2026-09-09', 0)}
                    onToggle={() => {}}
                    onOpen={() => {}}
                    onSetStatus={() => {}}
                />
            </>,
        ),
    play: async ({ canvasElement }) => {
        const titles = canvasElement.querySelectorAll<HTMLElement>(
            '[data-testid="task-chip-title"]',
        )
        const sourcedChip = titles[0].closest('div')!
        const selfOwnedChip = titles[1].closest('div')!
        expect(sourcedChip.getAttribute('draggable')).toBe('true')
        // dom-expressions may either write "false" or drop the attribute entirely for a
        // false boolean prop — either reading means "not draggable", so only "true" counts.
        expect(selfOwnedChip.getAttribute('draggable')).not.toBe('true')
    },
}

/** THE RULING this pair of stories proves: a self-owned base's row (no `source:`, so no
 *  `note.line`) can be CREATED from the calendar (Toolbar.tsx's `[ + task ]`) but cannot be
 *  COMPLETED from the grid, because completion rewrites a markdown line and such a row has
 *  none. Before `isTaskLine` was extracted and applied here, the marker's click/context-menu
 *  handlers had NO such guard — only `draggable` did — so clicking this exact chip's checkbox
 *  threw a 500 (`toggleTaskLine(undefined, …)`) instead of failing gracefully. This story is
 *  what would have caught that: it asserts `onToggle`/`onSetStatus` are NEVER called for a
 *  non-writable row, and that the click still does something useful (opens the note) rather
 *  than landing in a silent dead zone. Also the story the visual sweep sees the dimmed
 *  (`opacity: 0.4`, `aria-disabled`) marker through — see TaskChip.module.css's `.readOnly`. */
export const MarkerNotInteractiveForSelfOwnedRow: Story = {
    render: () => {
        const calls: string[] = []
        ;(window as unknown as { __calls?: string[] }).__calls = calls
        return cell(
            <TaskChip
                task={task('self-owned row', '2026-09-09', 0)}
                onToggle={() => calls.push('toggled')}
                onOpen={() => calls.push('opened')}
                onSetStatus={() => calls.push('status')}
            />,
        )
    },
    play: async ({ canvasElement }) => {
        const calls = (window as unknown as { __calls: string[] }).__calls
        const marker = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-marker"]',
        )!
        expect(marker.getAttribute('aria-disabled')).toBe('true')
        expect(marker.title).toContain("Can't toggle")

        // Clicking the marker must NOT toggle — but must not be a dead zone either: the click
        // falls through to the chip's own open-on-click, same as clicking the title would.
        await userEvent.click(marker)
        expect(calls).toEqual(['opened'])
        calls.length = 0

        // Right-click must NOT open the status menu.
        marker.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(within(document.body).queryByText('Done')).not.toBeInTheDocument()
        expect(calls).toEqual([])
    },
}

/** The interactive counterpart — a writable (sourced) row's marker DOES toggle on click, proven
 *  the same way (by actually clicking), so this pair can only both pass if the gate is wired
 *  correctly in both directions. */
export const MarkerInteractiveForSourcedRow: Story = {
    render: () => {
        const calls: string[] = []
        ;(window as unknown as { __calls2?: string[] }).__calls2 = calls
        return cell(
            <TaskChip
                task={task('sourced task', '2026-09-09', 0, { line: 7, field: 'due' })}
                onToggle={() => calls.push('toggled')}
                onOpen={() => calls.push('opened')}
                onSetStatus={() => calls.push('status')}
            />,
        )
    },
    play: async ({ canvasElement }) => {
        const calls = (window as unknown as { __calls2: string[] }).__calls2
        const marker = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-marker"]',
        )!
        expect(marker.getAttribute('aria-disabled')).toBeNull()
        await userEvent.click(marker)
        expect(calls).toEqual(['toggled'])
    },
}
