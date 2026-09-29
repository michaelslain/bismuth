// Visual spec for <ListView> — the compact row-list renderer (also handles task rows with
// native checkbox glyphs). Exercises `sampleViewResult` end to end: real rows, run through the
// real query engine (core/src/bases/query.ts `runView`), rendered by the real ListView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { ListView } from './ListView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { EMPTY_FILE, syntheticBaseFile } from '../../../core/src/bases/types'
import type {
    Row,
    ViewResult,
    BaseConfig,
    ViewConfig,
} from '../../../core/src/bases/types'
import { runView } from '../../../core/src/bases/query'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { formatDateField } from '../../../core/src/taskFields'

const meta = {
    title: 'Bases/ListView',
    component: ListView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ListView>

export default meta
type Story = StoryObj<typeof meta>

/** The curated sample dataset (text/number/checkbox/date/select/multiselect columns). */
export const Default: Story = {
    render: () => (
        <ListView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
    // Not editable (no basePath): the title is a NoteLink, the row is not a button.
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('button')).toBeNull()
        expect(canvasElement.querySelector('a')).toBeTruthy()
    },
}

// A row STORED in a base's own body (see TableView.stories.tsx's STORED_CONFIG for the shape).
const STORED_CONFIG: BaseConfig = {
    declaredProperties: ['description', 'status'],
    view: { type: 'list' },
}
const STORED_ROWS: Row[] = [
    {
        file: syntheticBaseFile('boards/stored-list.md'),
        note: { description: 'ship the parser', status: 'Todo' },
        formula: {},
        index: 0,
    },
]

/** With `basePath` set (openRowEditor.tsx wired), an owned row's row button opens the editor
 *  directly — it has no note of its own to open. Right-click opens the same editor (no
 *  separate pencil icon anywhere — see BulletsView/CardsView for the same treatment). */
export const EditableOwnedRow: Story = {
    render: () => (
        <ListView
            result={runView(STORED_CONFIG, STORED_ROWS)}
            config={STORED_CONFIG}
            basePath="boards/stored-list.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('button')
        expect(row).toBeTruthy()
        expect(row!.textContent ?? '').toContain('ship the parser')

        row!.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
}

/** With `basePath` set, a note row now opens the property editor on left-click too (matching
 *  CardsView/KanbanView) — right-click opens the same editor. A non-editable row (no
 *  basePath) is the one that still opens the note; that path has no story of its own here
 *  because that path is now a NoteLink on the title (see Default's play). */
export const EditableNoteRow: Story = {
    render: () => (
        <ListView
            result={sampleViewResult()}
            config={sampleBaseConfig()}
            basePath="projects/tasks.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('button')
        expect(row).toBeTruthy()

        row!.click()
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
}

/** Grouped by `status` — a colored group heading + row count per distinct value. Play asserts
 *  the `// N` count GroupHeader renders on every header. */
export const Grouped: Story = {
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toMatch(/\/\/ \d+/)
    },
    render: () => {
        const view = {
                type: 'list' as const,
                groupBy: { property: 'status' },
            }
        return (
            <ListView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
}

// ---- task rows: every bracket field, rendered as a chip ----------------------------------

/** One task row, shaped like `taskToRow` (core/src/bases/taskRow.ts) actually emits — same
 *  `note.*` keys, `raw`/`line`/`status` included so `isTaskRow` recognises it as a task row
 *  rather than an ordinary note row. */
function taskRow(
    description: string,
    opts: {
        line: number
        priority?: string
        start?: string
        scheduled?: string
        due?: string
        recurrence?: string
        resolved?: boolean
    },
): Row {
    return {
        file: {
            ...EMPTY_FILE,
            name: 'tasks',
            basename: 'tasks',
            path: 'tasks.md',
        },
        note: {
            description,
            status: opts.resolved ? 'done' : 'todo',
            statusChar: opts.resolved ? 'x' : ' ',
            line: opts.line,
            raw: `- [${opts.resolved ? 'x' : ' '}] ${description}`,
            priority: opts.priority,
            start: opts.start,
            scheduled: opts.scheduled,
            due: opts.due,
            recurrence: opts.recurrence,
        },
        formula: {},
    }
}

const TASKS_VIEW: ViewConfig = { type: 'list' }

function tasksResult(rows: Row[]): ViewResult {
    return {
        view: TASKS_VIEW,
        columns: [],
        groups: [{ key: '', rows }],
        summaries: {},
    }
}

const TASKS_BASE_CONFIG: BaseConfig = {
    source: { kind: 'tasks' },
    view: TASKS_VIEW,
}

// Computed ONCE at module load, not re-derived separately inside `render()` and `play()` —
// both read the exact same dates, so there's no risk of the two drifting apart across a
// midnight rollover between the two calls. `formatDateField` is the SAME function the
// component itself calls to draw a chip, so the expected strings below can never diverge
// from the component's own formatting — a stories-side reimplementation could.
const FIXTURE = (() => {
    const today = todayISO()
    const start = addDaysISO(today, -2)
    const scheduled = addDaysISO(today, 2)
    const overdueDue = addDaysISO(today, -3) // in the past + unresolved -> overdue
    const futureDue = addDaysISO(today, 10) // the CONTROL: in the future -> never overdue
    return {
        start,
        scheduled,
        overdueDue,
        futureDue,
        rows: [
            taskRow('plan the offsite', {
                line: 1,
                priority: 'high',
                start,
                scheduled,
                due: overdueDue,
                recurrence: 'every week',
            }),
            taskRow('renew passport', {
                line: 2,
                due: futureDue,
            }),
        ],
    }
})()

/**
 * All four bracket fields on one task line — `[start …]`, `[scheduled …]`, `[due …]`,
 * `[every …]` — plus priority, so every glyph this task deleted (🛫 ⏳ 📅 🔁 and the
 * 🔺⏫🔼🔽⏬ ladder) has a chip standing in for it. `plan the offsite`'s `due` is 3 days in
 * the PAST and the task is unresolved, so the overdue styling on that one chip actually
 * renders. `renew passport`'s `due` is 10 days in the FUTURE — the control row, proving the
 * overdue class is conditional rather than something every due chip always carries.
 *
 * `play()` asserts the specific things this story exists to prove, not just "it rendered
 * without throwing": every chip's exact text (so a formatter regression that renders an
 * empty string or drops a field is caught, not just a crash), and the overdue CLASS on the
 * two due chips (so the class binding itself — not merely the "Nd late"-style text some
 * other view might draw — is what's being checked). Without this, `playCheck.ts` grades the
 * story SKIP, and a mutation deleting the whole due block or making `overdue()` a no-op
 * would still render five other chips and pass every other gate in this repo.
 */
export const TasksWithMetadata: Story = {
    // REAL callbacks: the checkbox flips the row's status in a signal, so the interaction this
    // story shows is a working one (a noop would render a box that does nothing).
    render: () => {
        const [rows, setRows] = createSignal<Row[]>(FIXTURE.rows)
        return (
            <ListView
                result={tasksResult(rows())}
                config={TASKS_BASE_CONFIG}
                onToggle={row =>
                    setRows(rs =>
                        rs.map(r =>
                            r === row
                                ? {
                                      ...r,
                                      note: {
                                          ...r.note,
                                          status:
                                              r.note.status === 'done'
                                                  ? 'todo'
                                                  : 'done',
                                      },
                                  }
                                : r,
                        ),
                    )
                }
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)

        const priorityChip = canvas.getByText('[high]')
        const startChip = canvas.getByText(
            formatDateField('start', FIXTURE.start),
        )
        const scheduledChip = canvas.getByText(
            formatDateField('scheduled', FIXTURE.scheduled),
        )
        const overdueChip = canvas.getByText(
            formatDateField('due', FIXTURE.overdueDue),
        )
        const recurrenceChip = canvas.getByText('[every week]')
        const futureChip = canvas.getByText(
            formatDateField('due', FIXTURE.futureDue),
        )

        // All five fields on the first row render, with the exact bracket text the field
        // table promises — not merely "some chip exists somewhere".
        expect(priorityChip).toBeInTheDocument()
        expect(startChip).toBeInTheDocument()
        expect(scheduledChip).toBeInTheDocument()
        expect(overdueChip).toBeInTheDocument()
        expect(recurrenceChip).toBeInTheDocument()
        expect(futureChip).toBeInTheDocument()

        // The overdue class lives in TaskFieldChips's own module, so compare the RENDERED
        // colour: the overdue chip must differ from the control row's future-dated due chip,
        // or a mutation making every due chip "overdue" would still pass.
        expect(getComputedStyle(overdueChip).color).not.toBe(
            getComputedStyle(futureChip).color,
        )

        // The toggle is wired to real state: clicking the first row's box flips it.
        const box = canvas.getAllByRole('checkbox')[0]
        expect(box.getAttribute('aria-checked')).toBe('false')
        await userEvent.click(box)
        await waitFor(() =>
            expect(
                canvas.getAllByRole('checkbox')[0].getAttribute('aria-checked'),
            ).toBe('true'),
        )
    },
}

/** A zero-row view shows the `no rows` empty state. */
export const Empty: Story = {
    render: () => (
        <ListView
            result={{ ...sampleViewResult(), groups: [] }}
            config={sampleBaseConfig()}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        expect(c.getByText('no rows')).toBeInTheDocument()
        expect(
            c.getByText('nothing in this view matches its filters'),
        ).toBeInTheDocument()
    },
}
