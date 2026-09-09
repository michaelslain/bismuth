// Visual spec for <ListView> — the compact row-list renderer (also handles task rows with
// native checkbox glyphs). Exercises `sampleViewResult` end to end: real rows, run through the
// real query engine (core/src/bases/query.ts `runView`), rendered by the real ListView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ListView } from './ListView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { EMPTY_FILE } from '../../../core/src/bases/types'
import type { Row, ViewResult, BaseConfig, ViewConfig } from '../../../core/src/bases/types'
import { todayISO, addDaysISO } from '../../../core/src/dates'

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
}

/** Grouped by `status` — a colored group heading + row count per distinct value. */
export const Grouped: Story = {
    render: () => {
        const views = [
            {
                type: 'list' as const,
                name: 'List',
                groupBy: { property: 'status' },
            },
        ]
        return (
            <ListView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
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
        file: { ...EMPTY_FILE, name: 'tasks', basename: 'tasks', path: 'tasks.md' },
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

const TASKS_VIEW: ViewConfig = { type: 'list', name: 'List' }

function tasksResult(rows: Row[]): ViewResult {
    return { view: TASKS_VIEW, columns: [], groups: [{ key: '', rows }], summaries: {} }
}

const TASKS_BASE_CONFIG: BaseConfig = {
    source: { kind: 'tasks' },
    views: [TASKS_VIEW],
}

/**
 * All four bracket fields on one task line — `[start …]`, `[scheduled …]`, `[due …]`,
 * `[every …]` — plus priority, so every glyph this task deleted (🛫 ⏳ 📅 🔁 and the
 * 🔺⏫🔼🔽⏬ ladder) has a chip standing in for it. `due` is 3 days in the PAST and the
 * task is unresolved, so the overdue styling on that one chip actually renders — the
 * thing `bench/` invariants can only see if a story draws it.
 */
export const TasksWithMetadata: Story = {
    render: () => {
        const today = todayISO()
        const rows = [
            taskRow('plan the offsite', {
                line: 1,
                priority: 'high',
                start: addDaysISO(today, -2),
                scheduled: addDaysISO(today, 2),
                due: addDaysISO(today, -3),
                recurrence: 'every week',
            }),
            taskRow('renew passport', {
                line: 2,
                due: addDaysISO(today, 10),
            }),
        ]
        return (
            <ListView
                result={tasksResult(rows)}
                config={TASKS_BASE_CONFIG}
            />
        )
    },
}
