// Visual spec for <BulletsView> — the plain markdown-style bullet list renderer. Exercises
// `sampleViewResult` end to end: real rows, run through the real query engine
// (core/src/bases/query.ts `runView`), rendered by the real BulletsView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { BulletsView } from './BulletsView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import { EMPTY_FILE } from '../../../core/src/bases/types'
import type { Row, BaseConfig, ViewResult } from '../../../core/src/bases/types'
import { runView } from '../../../core/src/bases/query'

const meta = {
    title: 'Bases/BulletsView',
    component: BulletsView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BulletsView>

export default meta
type Story = StoryObj<typeof meta>

/** The curated sample dataset as a flat bullet list — one `<li>` per row, first column only. */
export const Default: Story = {
    render: () => (
        <BulletsView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
    // A bullet must open its row (the bug this fix addresses: BulletsView used to render a
    // bare, unclickable `renderValue` for every row). A note row's bullet is a live anchor.
    play: async ({ canvasElement }) => {
        const link = canvasElement.querySelector('li a')
        expect(link).toBeTruthy()
    },
}

// A row STORED in a base's own body (see TableView.stories.tsx's STORED_CONFIG for the shape).
const STORED_CONFIG: BaseConfig = {
    declaredProperties: ['description', 'status'],
    view: { type: 'bullets' },
}
const STORED_ROWS: Row[] = [
    {
        file: syntheticBaseFile('boards/stored-bullets.md'),
        note: { description: 'ship the parser', status: 'Todo' },
        formula: {},
        index: 0,
    },
]

/** With `basePath` set (openRowEditor.tsx wired), an owned row's bullet becomes a real button
 *  that opens the row editor — it has no note of its own to open. */
export const EditableOwnedRow: Story = {
    render: () => (
        <BulletsView
            result={runView(STORED_CONFIG, STORED_ROWS)}
            config={STORED_CONFIG}
            basePath="boards/stored-bullets.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('li button')
        expect(btn).toBeTruthy()
        expect(btn!.textContent ?? '').toContain('ship the parser')

        const li = canvasElement.querySelector('li')!
        li.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
}

/** With `basePath` set, a note row's bullet keeps opening the note on click; right-click on
 *  the row opens the property editor. */
export const EditableNoteRow: Story = {
    render: () => (
        <BulletsView
            result={sampleViewResult()}
            config={sampleBaseConfig()}
            basePath="projects/tasks.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const li = canvasElement.querySelector('li')!
        li.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
}

/** Grouped by `status` — a group heading per distinct value, same `ResultGroup` shape
 *  kanban/table use, rendered here as sub-headed bullet lists instead of columns/rows. */
export const Grouped: Story = {
    render: () => {
        const view = {
                type: 'bullets' as const,
                groupBy: { property: 'status' },
            }
        return (
            <BulletsView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
}

/** Grouped: play asserts the `// N` count the GroupHeader renders. */
export const GroupedCount: Story = {
    render: () => {
        const view = {
                type: 'bullets' as const,
                groupBy: { property: 'status' },
            }
        return (
            <BulletsView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toMatch(/\/\/ \d+/)
    },
}

/** A zero-row view shows the `no rows` empty state. */
export const Empty: Story = {
    render: () => (
        <BulletsView
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

function taskRowOf(description: string, line: number, status = 'todo'): Row {
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
            statusChar: status === 'done' ? 'x' : ' ',
            line,
            raw: `- [${status === 'done' ? 'x' : ' '}] ${description}`,
        },
        formula: {},
    }
}

/** Tasks mode with REAL callbacks: the checkbox flips the row's status in a signal and the
 *  list re-renders with it. */
export const TasksMode: Story = {
    render: () => {
        const view = { type: 'bullets' as const }
        const [rows, setRows] = createSignal<Row[]>([
            taskRowOf('write the parser', 1),
            taskRowOf('ship it', 2),
        ])
        const result = (): ViewResult => ({
            view,
            columns: [],
            groups: [{ key: '', rows: rows() }],
            summaries: {},
        })
        return (
            <BulletsView
                result={result()}
                config={{ source: { kind: 'tasks' }, view }}
                mode="tasks"
                onToggle={row =>
                    setRows(rs =>
                        rs.map(r =>
                            r === row
                                ? taskRowOf(
                                      String(r.note.description),
                                      r.note.line as number,
                                      r.note.status === 'done'
                                          ? 'todo'
                                          : 'done',
                                  )
                                : r,
                        ),
                    )
                }
            />
        )
    },
    play: async ({ canvasElement }) => {
        const boxes = () => within(canvasElement).getAllByRole('checkbox')
        expect(boxes()[0].getAttribute('aria-checked')).toBe('false')
        await userEvent.click(boxes()[0])
        await waitFor(() =>
            expect(boxes()[0].getAttribute('aria-checked')).toBe('true'),
        )
        expect(boxes()[1].getAttribute('aria-checked')).toBe('false')
    },
}
