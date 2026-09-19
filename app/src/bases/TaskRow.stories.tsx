// Visual spec for <TaskRow> — the ONE task line every row view renders in tasks mode.
//
// Rows are built through the REAL producers (`taskToRow` for a task scanned out of a note,
// `normalizeStoredTaskRow` for one stored as a YAML row in a base's own body) rather than by
// hand-writing `note.*`. A hand-built fixture can quietly stop matching what the app actually
// passes in — which is the failure mode this component exists to prevent, since both producers
// are supposed to be indistinguishable to it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
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
            canvas.getByText('done — shipped').classList.contains(styles.done),
        ).toBe(true)
        expect(
            canvas
                .getByText('cancelled — decided against')
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
        // The bare row contributes no chips, so exactly five exist on the page.
        expect(
            canvasElement.querySelectorAll(`.${styles.taskField}`).length,
        ).toBe(5)
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
        const canvas = within(canvasElement)
        const chips = canvasElement.querySelectorAll(`.${styles.taskField}`)
        expect(chips.length).toBe(4)
        const overdue = [...chips].map(c =>
            c.classList.contains(styles.overdue),
        )
        expect(overdue).toEqual([true, false, false, false])
        // …and the one that IS overdue is the row that says so, not merely "some chip".
        expect(
            canvas
                .getByText(formatDateField('due', DATES.overdue), {
                    selector: `.${styles.overdue}`,
                })
                .textContent,
        ).toBe(formatDateField('due', DATES.overdue))
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
        expect(canvas.getByText('ship it').tagName).toBe('STRONG')
        expect(canvas.getByText('soon').tagName).toBe('EM')
        // The wikilink and the tag are the two that carry their own class, and both are
        // module-hashed — a call site holding a stale literal would render unstyled text.
        expect(
            canvas.getByText('the spec').classList.contains(styles.taskLink),
        ).toBe(true)
        expect(canvas.getByText('#q4').classList.contains(styles.taskTag)).toBe(
            true,
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
