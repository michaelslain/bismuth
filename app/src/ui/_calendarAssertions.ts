// app/src/ui/_calendarAssertions.ts
// Story-only helpers shared by app/src/bases/CalendarView.stories.tsx (the "tasks" register,
// a Bases view kind) and app/src/calendar/components/views/MonthView.stories.tsx (the
// underlying month grid both `mode: "tasks"` and plain events render through). Both files
// used to carry verbatim copies of `assertChipsWhole`/`assertHeaderAligned`/`taskRow` — moved
// here (precedent: ui/_fontFace.ts) once a third caller made "just duplicate it, a story can't
// import another story file's private helper" the wrong call: the rule that bites is "a story
// must not import a COMPONENT's `.module.css`", not "a story may not import a shared,
// underscore-prefixed helper module" — `.storybook/main.ts`'s glob already skips these files.
import { expect } from 'storybook/test'
import { EMPTY_FILE } from '../../../core/src/bases/types'
import type { Row } from '../../../core/src/bases/types'

/** Every chip keeps its natural height (not squashed) and sits wholly inside its own day cell. */
export function assertChipsWhole(canvasElement: HTMLElement, chipSelector: string): void {
    const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')]
    let seen = 0
    cells.forEach((cell, i) => {
        const cb = cell.getBoundingClientRect()
        cell.querySelectorAll<HTMLElement>(chipSelector).forEach(chip => {
            seen++
            const r = chip.getBoundingClientRect()
            // A squashed chip's box is shorter than its content (a few px box, ~22px content).
            expect(r.height, `chip in cell ${i} squashed`).toBeGreaterThanOrEqual(chip.scrollHeight - 1)
            expect(r.top, `chip in cell ${i} escapes top`).toBeGreaterThanOrEqual(cb.top - 1)
            expect(r.bottom, `chip in cell ${i} escapes bottom`).toBeLessThanOrEqual(cb.bottom + 1)
            expect(r.left).toBeGreaterThanOrEqual(cb.left - 1)
            expect(r.right).toBeLessThanOrEqual(cb.right + 1)
        })
    })
    expect(seen, 'no chips found — the assertion would be vacuous').toBeGreaterThan(0)
}

export function assertHeaderAligned(canvasElement: HTMLElement): void {
    const names = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-day-name"]')]
    const cells = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="month-cell"]')].slice(0, 7)
    expect(names).toHaveLength(7)
    names.forEach((n, i) => {
        expect(Math.abs(cells[i].getBoundingClientRect().left - n.getBoundingClientRect().left), `col ${i}`).toBeLessThanOrEqual(1)
        expect(Math.abs(cells[i].getBoundingClientRect().width - n.getBoundingClientRect().width), `col ${i}`).toBeLessThanOrEqual(1)
    })
}

/** One task row, shaped like `taskToRow` (core/src/bases/taskRow.ts) actually emits — same
 *  `note.*` keys, including the derived `placed` (scheduled falling back to due) the real
 *  pipeline always sets. `line` only needs to be unique per file for the toggle click to be
 *  wired to something real. */
export function taskRow(
    description: string,
    opts: {
        line: number
        scheduled?: string
        due?: string
        resolved?: boolean
        // Override for a resolved row whose real marker isn't `x` — a cancelled task (`-`).
        statusChar?: string
    },
): Row {
    const placed = opts.scheduled ?? opts.due
    const statusChar = opts.statusChar ?? (opts.resolved ? 'x' : ' ')
    // Mirrors core/src/taskReorder.ts's statusToChar mapping: '-' is 'cancelled', never 'done' —
    // a resolved-only derivation flattens the two the way TaskChip.tsx's own markerChar/
    // statusWord comments warn against.
    const status = statusChar === '-' ? 'cancelled' : opts.resolved ? 'done' : 'todo'
    return {
        file: {
            ...EMPTY_FILE,
            name: 'tasks',
            basename: 'tasks',
            path: 'tasks.md',
        },
        note: {
            description,
            status,
            statusChar,
            line: opts.line,
            scheduled: opts.scheduled,
            due: opts.due,
            placed,
            resolved: !!opts.resolved,
            recurring: false,
        },
        formula: {},
    }
}
