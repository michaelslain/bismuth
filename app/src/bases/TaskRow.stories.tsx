// Visual spec for <TaskRow> — the ONE task line every row view renders in tasks mode.
//
// Rows are built through the REAL producers (`taskToRow` for a task scanned out of a note,
// `normalizeStoredTaskRow` for one stored as a YAML row in a base's own body) rather than by
// hand-writing `note.*`. A hand-built fixture can quietly stop matching what the app actually
// passes in — which is the failure mode this component exists to prevent, since both producers
// are supposed to be indistinguishable to it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import TaskRow from './TaskRow'
import { taskToRow, normalizeStoredTaskRow } from '../../../core/src/bases/taskRow'
import { syntheticBaseFile, type Row } from '../../../core/src/bases/types'
import type { Task } from '../../../core/src/tasks'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { formatDateField } from '../../../core/src/taskFields'
import styles from './TaskRow.module.css'

const meta = {
    title: 'Bases/TaskRow',
    component: TaskRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** A task SCANNED out of a note's checkbox line — the query origin, which carries `note.line`. */
function scanned(t: Partial<Task> & { description: string }): Row {
    const status = t.status ?? 'todo'
    return taskToRow({
        path: 'tasks.md',
        line: 1,
        indent: '',
        raw: `- [ ] ${t.description}`,
        statusChar: ' ',
        priority: 'none',
        tags: [],
        ...t,
        status,
    } as Task)
}

/** A task STORED as a YAML row in a base's own body — the other origin, which carries
 *  `row.index` and no `line`. Put through the same normalizer the view host runs. */
function stored(note: Record<string, unknown>): Row {
    return normalizeStoredTaskRow({
        file: syntheticBaseFile('boards/tasks.md'),
        note,
        formula: {},
        index: 0,
    })
}

// Computed ONCE at module load so `render()` and `play()` can never straddle a midnight
// rollover between the two calls, and formatted through the SAME function the component calls,
// so an expected string cannot diverge from the component's own formatting.
const DATES = (() => {
    const today = todayISO()
    return {
        today,
        start: addDaysISO(today, -2),
        scheduled: addDaysISO(today, 2),
        overdue: addDaysISO(today, -3), // past + unresolved -> overdue
        future: addDaysISO(today, 10), // the CONTROL: never overdue
    }
})()

const Rows = (props: { rows: Row[]; variant?: 'list' | 'card' }) => (
    <div>
        {props.rows.map(r => (
            <TaskRow
                row={r}
                onToggle={noop}
                onSetStatus={noop}
                variant={props.variant}
            />
        ))}
    </div>
)

/** The four statuses, one row each. `done` and `cancelled` are the two that change the BODY
 *  as well as the box (strike-through + fade via `.taskBody.done` — cancelled deliberately
 *  keeps its body legible, since a cancelled task is not a completed one). */
export const EveryStatus: Story = {
    render: () => (
        <Rows
            rows={[
                scanned({ description: 'todo — nothing done yet' }),
                scanned({
                    description: 'in progress — half written',
                    status: 'in-progress',
                    statusChar: '/',
                }),
                scanned({
                    description: 'done — shipped',
                    status: 'done',
                    statusChar: 'x',
                    done: DATES.today,
                }),
                scanned({
                    description: 'cancelled — decided against',
                    status: 'cancelled',
                    statusChar: '-',
                }),
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(
            canvas
                .getAllByTitle('Toggle task — right-click to set status')
                .map(b => b.getAttribute('data-status')),
        ).toEqual(['todo', 'doing', 'done', 'cancelled'])
        // The done row's body strikes through; the cancelled row's does not. Both boxes
        // differ, so without this a swapped `.done` binding would still look plausible.
        expect(
            canvas
                .getByText('done — shipped')
                .closest(`.${styles.taskBody}`)!
                .classList.contains(styles.done),
        ).toBe(true)
        expect(
            canvas
                .getByText('cancelled — decided against')
                .closest(`.${styles.taskBody}`)!
                .classList.contains(styles.done),
        ).toBe(false)
    },
}

/** The same four statuses as `EveryStatus`, but `variant="card"` — the register a kanban or
 *  masonry card renders in: no 18px list gutter, `--fs-micro` instead of `--fs-ui`. Proves the
 *  variant prop actually reaches the row (via `.inCard`, not just visually) rather than only
 *  ever being exercised implicitly by KanbanView/EditCardsModal call sites. */
export const Card: Story = {
    render: () => (
        <Rows
            variant="card"
            rows={[
                scanned({ description: 'todo — nothing done yet' }),
                scanned({
                    description: 'in progress — half written',
                    status: 'in-progress',
                    statusChar: '/',
                }),
                scanned({
                    description: 'done — shipped',
                    status: 'done',
                    statusChar: 'x',
                    done: DATES.today,
                }),
                scanned({
                    description: 'cancelled — decided against',
                    status: 'cancelled',
                    statusChar: '-',
                }),
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(
            canvas
                .getAllByTitle('Toggle task — right-click to set status')
                .map(b => b.getAttribute('data-status')),
        ).toEqual(['todo', 'doing', 'done', 'cancelled'])
        // Every row carries the card register's class, not the list one.
        const rows = canvasElement.querySelectorAll(`.${styles.taskItem}`)
        expect(rows.length).toBe(4)
        for (const row of rows)
            expect(row.classList.contains(styles.inCard)).toBe(true)
    },
}

/** Every field chip at once — `[high]`, `[start …]`, `[scheduled …]`, `[due …]`, `[every …]` —
 *  next to a row carrying NONE of them, so "a chip renders" and "a chip renders only when its
 *  field is present" are both visible in one frame. */
export const EveryField: Story = {
    render: () => (
        <Rows
            rows={[
                scanned({
                    description: 'plan the offsite',
                    priority: 'high',
                    start: DATES.start,
                    scheduled: DATES.scheduled,
                    due: DATES.future,
                    recurrence: 'every week',
                }),
                scanned({ description: 'no fields at all' }),
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        for (const text of [
            '[high]',
            formatDateField('start', DATES.start),
            formatDateField('scheduled', DATES.scheduled),
            formatDateField('due', DATES.future),
            '[every week]',
        ])
            expect(canvas.getByText(text)).toBeInTheDocument()
        // The bare row contributes no chips, so nothing but the five above is on the page.
        expect(canvas.queryAllByTitle(/priority$/).length).toBe(1)
    },
}

/**
 * Overdue and its three controls, which is the whole point of the story: a past due date is
 * overdue ONLY while the task is unresolved.
 *
 * `play()` asserts the CLASS, not the colour — a colour comparison is brittle across the app's
 * four themes and would have to be re-blessed on a token rename, while the class binding is the
 * thing that can actually break. All three negative rows matter: a future due date, a DONE task
 * whose due date is in the past, and a CANCELLED one. The cancelled row is the reason
 * `isOverdue` reads `note.resolved` (done-or-cancelled) rather than `status === 'done'` — a
 * task nobody is going to do cannot be late.
 */
export const Overdue: Story = {
    render: () => (
        <Rows
            rows={[
                scanned({ description: 'late', due: DATES.overdue }),
                scanned({ description: 'not yet', due: DATES.future }),
                scanned({
                    description: 'finished late',
                    status: 'done',
                    statusChar: 'x',
                    due: DATES.overdue,
                    done: DATES.today,
                }),
                scanned({
                    description: 'abandoned',
                    status: 'cancelled',
                    statusChar: '-',
                    due: DATES.overdue,
                }),
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        // Compare the computed colour of each due chip: the class lives in TaskFieldChips's own
        // module (see TaskFieldChips.stories.tsx), so here we assert the outcome, not the class.
        const rows = canvasElement.querySelectorAll(`.${styles.taskItem}`)
        expect(rows.length).toBe(4)
        const dueColors = [...rows].map(r => {
            const chip = within(r as HTMLElement).getByText(
                new RegExp(`^\\[due `),
            )
            return getComputedStyle(chip).color
        })
        const late = dueColors[0]
        expect(late).not.toBe(getComputedStyle(canvasElement).color)
        // The future, done-late and cancelled rows are all NOT the overdue colour.
        expect(dueColors[1]).not.toBe(late)
        expect(dueColors[2]).not.toBe(late)
        expect(dueColors[3]).not.toBe(late)
    },
}

/** Inline markdown in the description: a wikilink, an external link, a #tag, bold and italic.
 *  A task line reads the way it does in the editor rather than as flat text — which is also
 *  why the description is not simply `textContent` anywhere in this component. */
export const InlineMarkup: Story = {
    render: () => (
        <Rows
            rows={[
                scanned({
                    description:
                        'review [[Design/Spec|the spec]] and **ship it** for #q4 — *soon*',
                }),
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('the spec')).toBeInTheDocument()
        expect(canvas.getByText('#q4')).toBeInTheDocument()
        // Bold and italic are weight and style on Text, not <strong>/<em>.
        expect(
            Number(getComputedStyle(canvas.getByText('ship it')).fontWeight),
        ).toBeGreaterThan(500)
        expect(getComputedStyle(canvas.getByText('soon')).fontStyle).toBe(
            'italic',
        )
        // The wikilink is a real link (focusable, reachable by Tab), not a styled span.
        expect(canvas.getByText('the spec').tagName).toBe('A')
    },
}

/** Clicking a wikilink opens its note; an external link opens a tab with noopener; a
 *  javascript: url is inert text. */
export const LinkClick: Story = {
    render: () => (
        <Rows
            rows={[
                scanned({
                    description:
                        'see [[Design/Spec|the spec]] or [docs](https://example.com/d) or [bad](javascript:alert(1))',
                }),
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const opened: string[] = []
        const onOpen = (e: Event) =>
            opened.push((e as CustomEvent<string>).detail)
        window.addEventListener('bismuth-open', onOpen)
        const realOpen = window.open
        const tabs: [unknown, unknown, unknown][] = []
        window.open = ((u: unknown, t: unknown, f: unknown) => {
            tabs.push([u, t, f])
            return null
        }) as typeof window.open
        try {
            await userEvent.click(canvas.getByText('the spec'))
            expect(opened).toEqual(['Design/Spec.md'])
            await userEvent.click(canvas.getByText('docs'))
            expect(tabs).toEqual([
                ['https://example.com/d', '_blank', 'noopener'],
            ])
            // The javascript: url is text: no button, no link.
            expect(canvas.getByText('bad').closest('a, button')).toBeNull()
        } finally {
            window.removeEventListener('bismuth-open', onOpen)
            window.open = realOpen
        }
    },
}

/**
 * The trailing edit pencil — present for BOTH origins (a scanned line task carries `note.line`,
 * a stored row carries a valid `index`), since `isEditableTask` (taskEdit.ts) accepts either.
 * It stays in the DOM (and the tab order) at all times — only its opacity is 0 until hover/
 * focus-within — so this asserts presence + aria-label rather than visibility, which a
 * screenshot diff covers instead.
 */
export const EditButton: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        return (
            <Rows
                rows={[
                    scanned({ description: 'a scanned line task' }),
                    stored({
                        description: 'a stored row task',
                        status: 'todo',
                    }),
                ]}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const buttons = canvas.getAllByLabelText('Edit task')
        expect(buttons.length).toBe(2)
        for (const b of buttons)
            expect(b.classList.contains(styles.editBtn)).toBe(true)
        // Clicking one opens the edit modal on that task (it portals to document.body).
        await userEvent.click(buttons[0])
        const body = within(document.body)
        expect(
            await body.findByDisplayValue('a scanned line task'),
        ).toBeInTheDocument()
        await userEvent.click(body.getByText('cancel'))
        await waitFor(() =>
            expect(
                body.queryByDisplayValue('a scanned line task'),
            ).not.toBeInTheDocument(),
        )
    },
}

/**
 * The SAME task from the two producers, stacked. This is the claim tasks mode rests on: a task
 * scanned out of a note's checkbox line and a task stored as a row in a base's own body are
 * indistinguishable to every view downstream. If the two rows below ever render differently,
 * one of the producers has drifted — and nothing else in the repo would notice, because each
 * one is unit-tested against its own expectations rather than against the other.
 */
export const BothOrigins: Story = {
    render: () => (
        <Rows
            rows={[
                scanned({
                    description: 'ship the parser',
                    priority: 'high',
                    due: DATES.overdue,
                    recurrence: 'every month',
                }),
                stored({
                    description: 'ship the parser',
                    priority: 'high',
                    due: DATES.overdue,
                    recurrence: 'every month',
                }),
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const rows = canvasElement.querySelectorAll(`.${styles.taskItem}`)
        expect(rows.length).toBe(2)
        // Compare the rendered MARKUP, not just the text: the box's data-status, the chip
        // classes and the overdue flag are all in here, so a divergence in any of them fails.
        expect(rows[0].innerHTML).toBe(rows[1].innerHTML)
    },
}
