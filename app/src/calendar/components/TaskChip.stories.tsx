// Visual spec for <TaskChip> — the tasks-register calendar's single chip. Carried-or-not is
// the entire register: a chip that is NOT carried has no box at all and reads as ordinary
// text; a carried chip (late > 0) gets the danger wash + hairline + trailing "Nd late" chosen
// from rendered mockups (design doc, Part 2 — the tasks calendar). See TaskChip.module.css for
// why the register is a wash rather than a solid fill or a muted outline.
import type { JSX } from 'solid-js'
import { createSignal, For } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TaskChip from './TaskChip'
import type { PlacedTask } from '../taskPlacement'
import { EMPTY_FILE } from '../../../../core/src/bases/types'
import { requestTaskFocus } from '../state'
import { taskKey } from '../taskChipKeys'

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

/** A category band — a 3px absolutely-positioned strip along the chip's leading edge, never a
 *  border (TaskChip.module.css's `.band`). Not carried, so this is the band alone with no
 *  danger wash to share space with. */
export const WithCategoryColour: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task('water the plants', '2026-09-09', 0)}
                color="var(--teal)"
                onToggle={() => {}}
                onOpen={() => {}}
                onSetStatus={() => {}}
            />,
        ),
}

/** THE acceptance case for this task: a carried chip (danger wash + hairline border) AND a
 *  category band must both be visible at once, never one replacing the other. The band is
 *  absolutely positioned rather than a second border specifically so it cannot collide with
 *  `.carried`'s own 1px `--danger` hairline. */
export const CarriedWithCategoryColour: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task('renew passport', '2026-08-15', 25)}
                color="var(--violet)"
                onToggle={() => {}}
                onOpen={() => {}}
                onSetStatus={() => {}}
            />,
        ),
}

/** A long description in a narrow cell must wrap onto as many lines as it needs — no clamp, no
 *  ellipsis — rather than force the cell open or clip mid-word. The title is the only flexible
 *  element in the chip's flex row; the marker and the "Nd late" suffix stay pinned to the
 *  title's first line and never wrap themselves. Carried, so the late suffix competes with the
 *  title for the same limited width on that first line. */
export const LongDescriptionWraps: Story = {
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
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-title"]',
        )!
        const chip = title.closest('div')!
        const lineHeight = parseFloat(getComputedStyle(title).lineHeight)
        // (a) the title actually wraps onto more than one line
        expect(title.getBoundingClientRect().height).toBeGreaterThanOrEqual(lineHeight * 2 - 1)
        // (b) nothing is clipped — scrollWidth never exceeds the rendered box
        expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1)
        // (c) the chip stays inside the 220px cell
        const cellEl = chip.parentElement!
        expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(
            cellEl.getBoundingClientRect().right + 1,
        )
    },
}

/** A single unbroken 60-character word (no spaces to break on) must still stay inside the
 *  220px cell — `overflow-wrap: anywhere` breaks mid-word rather than letting the title's
 *  natural min-content width blow out the column. */
export const LongUnbrokenWordWraps: Story = {
    render: () =>
        cell(
            <TaskChip
                task={task('a'.repeat(60), '2026-09-05', 0)}
                onToggle={() => {}}
                onOpen={() => {}}
                onSetStatus={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-title"]',
        )!
        const chip = title.closest('div')!
        // (b) nothing is clipped
        expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1)
        // (c) the chip stays inside the 220px cell
        const cellEl = chip.parentElement!
        expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(
            cellEl.getBoundingClientRect().right + 1,
        )
    },
}

/** The real case: a ~120px day column (a week/3-day view, not the 220px month cell above).
 *  Marker + "Nd late" alone already claim most of a column this narrow, so without wrapping the
 *  title would be starved down to 3-4 chars/line while everything stays crammed onto one line.
 *  `.chip`'s `flex-wrap: wrap` lets "11d late" flow onto its own line instead, so the title gets
 *  its `min-width: min(12ch, 100%)` floor on line one. */
export const CarriedNarrowColumn: Story = {
    render: () => (
        <div style={{ width: '120px', border: '1px solid var(--border)' }}>
            <TaskChip
                task={task(
                    'reply to the landlord about the lease renewal before the deadline',
                    '2026-08-30',
                    11,
                )}
                onToggle={() => {}}
                onOpen={() => {}}
                onSetStatus={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-title"]',
        )!
        // .late has no data-testid — it's the chip's third span, after the marker and the
        // title, which both do.
        const spans = [...title.closest('div')!.querySelectorAll<HTMLElement>('span')]
        const late = spans[spans.length - 1]

        // measure one '0' in the title's own font, rather than hardcoding a px stand-in for
        // "about 10 characters"
        const probe = document.createElement('span')
        probe.textContent = '0'
        probe.style.visibility = 'hidden'
        probe.style.position = 'absolute'
        probe.style.font = getComputedStyle(title).font
        document.body.appendChild(probe)
        const charWidth = probe.getBoundingClientRect().width
        probe.remove()

        // the title got real room (>= ~10 characters), not starved to 3-4 chars/line
        expect(title.getBoundingClientRect().width).toBeGreaterThanOrEqual(
            Math.max(charWidth * 10, 60),
        )
        // nothing is clipped
        expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1)
        // "Nd late" wrapped onto its own line below the title's first line — proof flex-wrap
        // actually fired, not just that the title happens to be wide enough
        expect(late.getBoundingClientRect().top).toBeGreaterThan(
            title.getBoundingClientRect().top,
        )
    },
}

/** The exact regression a design review caught: a ~171px WEEK column (not the 220px month
 *  cell, not the 120px stress test above) is where `.title`'s old `min-width: min(12ch, 100%)`
 *  pinned the title to a ~12-character ribbon on EVERY line once "Nd late" moved inline beside
 *  it — 13 lines for this chip, only 4 fitting the visible grid, versus 8 lines/6 chips before
 *  the regression. `min-width: min(22ch, 100%)` fixes it: below ~250px the late label drops to
 *  its own line instead (matching the month grid), so the title gets real per-line width back. */
export const CarriedWeekColumn: Story = {
    render: () => (
        <div style={{ width: '171px', border: '1px solid var(--border)' }}>
            <TaskChip
                task={task(
                    'follow up on the overdue item number 21 — a long enough description to wrap',
                    '2026-08-30',
                    2,
                )}
                onToggle={() => {}}
                onOpen={() => {}}
                onSetStatus={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>(
            '[data-testid="task-chip-title"]',
        )!
        const lineHeight = parseFloat(getComputedStyle(title).lineHeight)
        const lines = Math.round(title.getBoundingClientRect().height / lineHeight)
        // The regression wrapped this exact chip to 13 lines at this exact width. The fix
        // must land meaningfully under that — proof the floor actually moved, not a fluke of
        // this one description.
        expect(lines).toBeLessThan(10)
        // nothing clipped
        expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1)
    },
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

/** Keyboard access — the whole reason `taskChipKeys.ts` exists: without a mouse, a chip
 *  must still open (Enter), toggle (Space), and reschedule (Alt+arrows), and a read-only
 *  (self-owned) row must keep opening while refusing the write actions, exactly like its click
 *  handlers already do. Two chips side by side — one writable/carried, one read-only — so the
 *  gate is proven in both directions by actually dispatching `keydown`, not by reading an
 *  attribute. */
export const Keyboard: Story = {
    render: () => {
        const calls = { open: 0, toggle: 0, reschedule: [] as number[] }
        ;(window as unknown as { __keyCalls?: typeof calls }).__keyCalls = calls
        return cell(
            <>
                <TaskChip
                    task={task('pay rent', '2026-09-08', 3, { line: 3, field: 'scheduled' })}
                    onToggle={() => calls.toggle++}
                    onOpen={() => calls.open++}
                    onSetStatus={() => {}}
                    onReschedule={days => calls.reschedule.push(days)}
                />
                <TaskChip
                    task={task('self-owned row', '2026-09-09', 0)}
                    onToggle={() => calls.toggle++}
                    onOpen={() => calls.open++}
                    onSetStatus={() => {}}
                    onReschedule={days => calls.reschedule.push(days)}
                />
                <TaskChip
                    task={resolvedTask('abandoned redesign', '2026-08-20', '-')}
                    onToggle={() => calls.toggle++}
                    onOpen={() => calls.open++}
                    onSetStatus={() => {}}
                    onReschedule={days => calls.reschedule.push(days)}
                />
            </>,
        )
    },
    play: async ({ canvasElement }) => {
        const calls = (window as unknown as { __keyCalls: { open: number; toggle: number; reschedule: number[] } })
            .__keyCalls
        const [writableChip, readOnlyChip, cancelledChip] = [
            ...canvasElement.querySelectorAll<HTMLElement>('[role="button"]'),
        ]
        const press = (el: HTMLElement, key: string, mods: KeyboardEventInit = {}) =>
            el.dispatchEvent(
                new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }),
            )

        writableChip.focus()
        // Catches: tabindex/role missing or the chip not being a real focus target at all — a
        // chip that cannot receive focus is unreachable from the keyboard no matter what its
        // keydown handler does.
        expect(document.activeElement).toBe(writableChip)

        press(writableChip, 'Enter')
        press(writableChip, ' ')
        press(writableChip, 'ArrowDown', { altKey: true })
        // Catches: Enter not wired to onOpen, or chipKeyAction's 'open' case never reached.
        expect(calls.open).toBe(1)
        // Catches: Space not wired to onToggle, or the writable() gate wrongly blocking a
        // sourced row's own toggle.
        expect(calls.toggle).toBe(1)
        // Catches: Alt+ArrowDown not wired to onReschedule, or the wrong day delta (anything
        // but +7) reaching the callback.
        expect(calls.reschedule).toEqual([7])

        press(readOnlyChip, ' ')
        press(readOnlyChip, 'ArrowRight', { altKey: true })
        // Catches: the read-only gate being skipped for keyboard actions even though the mouse
        // path already refuses them — the counters must NOT move.
        expect(calls.toggle).toBe(1)
        expect(calls.reschedule).toEqual([7])

        press(readOnlyChip, 'Enter')
        // Catches: 'open' being folded into the writable() gate — a read-only row must still be
        // openable by keyboard, exactly as clicking its title already allows.
        expect(calls.open).toBe(2)

        // Catches: aria-label missing the lateness context a screen-reader user needs to tell a
        // carried chip from an ordinary one.
        expect(writableChip.getAttribute('aria-label')).toContain('days late')

        // I2: a `resolved`-derived status word collapses done AND cancelled to "done" — this
        // reads the raw statusChar ('-') instead. Catches a regression back to
        // `note.resolved ? 'done' : ''`, which would put "done" back on a cancelled task.
        expect(cancelledChip.getAttribute('aria-label')).toMatch(/\bcancelled\b/)
        expect(cancelledChip.getAttribute('aria-label')).not.toMatch(/\bdone\b/)

        // I2: a read-only chip's Space/Shift+F10/Alt+arrows do nothing (the writable() gate
        // above already proved that for Space) — advertising them via aria-keyshortcuts lies to
        // a screen-reader user about what the row can do. Only Enter (open) is real for this row.
        expect(readOnlyChip.getAttribute('aria-keyshortcuts')).toBe('Enter')
    },
}

/** "Focus follows the task" (I5) — proven, not merely documented. A keyboard reschedule or
 *  toggle rewrites the row; the refetch renders the chip as a NEW element, often in another
 *  cell (see the module comment at the top of TaskChip.tsx). `state.ts`'s
 *  `focusTaskKey`/`requestTaskFocus` exist to carry focus across that remount instead of it
 *  falling back to <body>. This story simulates the remount directly: a signal holds the
 *  PlacedTask; `requestTaskFocus` claims the OLD chip's key (by file path + line, not object
 *  identity — `taskKey`), then the signal is set to a NEW object at that SAME identity (a
 *  changed `late`, as a real reschedule would produce) so `<For>`'s reference-keying tears the
 *  old chip down and mounts a genuinely different DOM node. At the moment the new chip's
 *  onMount runs, focus is on the old chip (about to be removed) or already reset to <body> by
 *  the browser — never on some unrelated third element — matching the case M2's onMount guard
 *  must still let through.
 *
 *  Must fail if TaskChip's onMount focus-consumption (`if (focusWasLost()) root?.focus()`) is
 *  removed or never runs: without it, the browser's own "focused node removed from DOM"
 *  behavior parks `document.activeElement` on <body> and leaves it there, so the final
 *  assertion below would read `body`, not the new chip. */
export const FocusFollowsRemount: Story = {
    render: () => {
        const initial = task('reschedule me', '2026-09-09', 0, { line: 5, field: 'due' })
        const [current, setCurrent] = createSignal<PlacedTask>(initial)
        ;(window as unknown as {
            __remount?: { initial: PlacedTask; setTask: (t: PlacedTask) => void }
        }).__remount = { initial, setTask: setCurrent }
        return cell(
            <For each={[current()]}>
                {t => (
                    <TaskChip
                        task={t}
                        onToggle={() => {}}
                        onOpen={() => {}}
                        onSetStatus={() => {}}
                    />
                )}
            </For>,
        )
    },
    play: async ({ canvasElement }) => {
        const { initial, setTask } = (
            window as unknown as {
                __remount: { initial: PlacedTask; setTask: (t: PlacedTask) => void }
            }
        ).__remount
        const oldChip = canvasElement.querySelector<HTMLElement>('[role="button"]')!

        requestTaskFocus(taskKey(initial.row))
        oldChip.focus()
        expect(document.activeElement).toBe(oldChip)

        setTask({ ...initial, late: 3 })
        await new Promise(r => setTimeout(r, 0))

        const newChip = canvasElement.querySelector<HTMLElement>('[role="button"]')!
        expect(newChip).not.toBe(oldChip)
        expect(document.activeElement).toBe(newChip)
    },
}
