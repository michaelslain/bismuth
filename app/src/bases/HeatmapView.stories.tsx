// Visual spec for <HeatmapView> — the GitHub-style contribution grid, over the same
// `buildChartData`/`buildHeatmapWeeks` pipeline (core/src/bases/chart.ts) as the other chart
// views, but always day-binned. Requires an `x` that resolves to ISO date strings (or a
// majority-date column for auto-detection) or it renders the empty state.
import { createMemo, createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import type { Row } from '../../../core/src/bases/types'
import { runView } from '../../../core/src/bases/query'
import { todayISO, addDaysISO } from '../../../core/src/dates'
import { HeatmapView } from './HeatmapView'
import type { HeatmapWriteSeam } from './heatmapWrites'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/HeatmapView',
    component: HeatmapView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof HeatmapView>

export default meta
type Story = StoryObj<typeof meta>

function entryRow(i: number, iso: string, words: number): Row {
    return {
        file: {
            name: `entry-${i}`,
            basename: `entry-${i}`,
            path: `journal/entry-${i}.md`,
            folder: 'journal',
            ext: 'md',
            size: 128,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note: { date: iso, words },
        formula: {},
    }
}

/** A row stored in a base file's own table: `index` (position in that table) + `file.path` =
 *  the base file itself — the two write-back handles `heatmapWrites.ts`/BaseView's write seam
 *  need (see BaseView.tsx's heatmap-write-seam comment). `y` is optional so the same helper
 *  builds both a numeric log (EditableValues) and a plain habit-check (ToggleDays, no `words`). */
function baseRow(i: number, iso: string, basePath: string, words?: number): Row {
    return {
        file: {
            name: 'Journal',
            basename: 'Journal',
            path: basePath,
            folder: '',
            ext: 'md',
            size: 128,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note: words === undefined ? { date: iso } : { date: iso, words },
        formula: {},
        index: i,
    }
}

/** `x: "due"` explicit (the curated dataset's date column) — a sparse grid spanning the rows'
 *  due dates, plus the streak footer line. */
export const Default: Story = {
    render: () => {
        const views = [{ type: 'heatmap' as const, name: 'Activity', x: 'due' }]
        return (
            <HeatmapView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** A denser dataset — daily entries over three consecutive weeks ending today — so the streak
 *  footer shows a real multi-day run instead of isolated single days. */
export const DenseActivity: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = Array.from({ length: 18 }, (_, i) => {
            const iso = addDaysISO(today, i - 17)
            return entryRow(i, iso, 200 + ((i * 37) % 400))
        })
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** A full year of sparse activity — every 3rd day — spanning month boundaries, to check the
 *  grid spans the whole pane and month labels don't collide. */
export const YearOfData: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Year', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = []
        for (let i = 0; i < 365; i += 3) {
            const iso = addDaysISO(today, i - 364)
            rows.push(entryRow(i, iso, 50 + ((i * 13) % 300)))
        }
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** `x` resolves to a non-date column (status) — the empty state must show, not a blank grid. */
export const NonDateX: Story = {
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('no data to chart'))
        expect(canvasElement.textContent).toContain('set an x date column')
    },
    render: () => {
        const views = [{ type: 'heatmap' as const, name: 'Activity', x: 'status' }]
        return (
            <HeatmapView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** Every square is a real button, so Tab reaches it and focus alone shows its readout — a
 *  keyboard user sees what a pointer user does. */
export const KeyboardReach: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const rows: Row[] = [entryRow(0, todayISO(), 400)]
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const cell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${todayISO()}"]`,
            )
            if (!el) throw new Error('today cell not yet rendered')
            return el
        })
        expect(cell.tagName).toBe('BUTTON')
        cell.focus()
        await waitFor(() => expect(canvasElement.querySelector('[class*="active"]')).not.toBeNull())
        await userEvent.keyboard('{Enter}')
        await waitFor(() => {
            const clear = Array.from(canvasElement.querySelectorAll('button')).find(b =>
                b.textContent?.includes('clear'),
            )
            if (!clear) throw new Error('drill not yet open')
        })
        // Opening the drill must not cost the keyboard user their place.
        const key = cell.dataset.bucket!
        await userEvent.keyboard('{Enter}')
        await waitFor(() => {
            const clear = Array.from(canvasElement.querySelectorAll('button')).find(b =>
                b.textContent?.includes('clear'),
            )
            expect(clear).toBeUndefined()
        })
        expect(document.activeElement).toBe(
            canvasElement.querySelector(`[data-bucket="${key}"]`),
        )
    },
}

/** Hover shows the bucket's date/value/note-count in the readout; clicking opens the drill list
 *  of notes behind that day, and clicking again (or `[ clear ]`) closes it. */
export const HoverAndDrill: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = [
            entryRow(0, today, 400),
            entryRow(1, today, 120),
        ]
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const todayCell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${todayISO()}"]`,
            )
            if (!el) throw new Error('today cell not yet rendered')
            return el
        })
        todayCell.dispatchEvent(
            new PointerEvent('pointerenter', { bubbles: true }),
        )
        await waitFor(() => {
            const active = canvasElement.querySelector('[class*="active"]')
            if (!active) throw new Error('readout not yet active')
            return active
        })
        todayCell.click()
        const clear = await waitFor(() => {
            const btn = Array.from(
                canvasElement.querySelectorAll('button'),
            ).find(b => b.textContent?.includes('clear'))
            if (!btn) throw new Error('drill not yet open')
            return btn
        })
        expect(clear).toBeTruthy()
    },
}

/** The latest entry is a year ago — the grid ends there, not at today, so an idle dataset still
 *  reads as a year of ITS history rather than mostly-empty recent weeks. */
export const OldDataOnly: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Old journal', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const base = addDaysISO(today, -365)
        const rows: Row[] = Array.from({ length: 5 }, (_, i) =>
            entryRow(i, addDaysISO(base, i), 150 + i * 10),
        )
        return (
            <HeatmapView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}

/** A ~300px pane — the grid still renders without horizontal overflow (columns floor at 20). */
export const Narrow: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const rows: Row[] = Array.from({ length: 10 }, (_, i) =>
            entryRow(i, addDaysISO(today, i - 9), 100 + i * 20),
        )
        return (
            <div style={{ width: '300px' }}>
                <HeatmapView
                    result={sampleViewResult(rows, { views })}
                    config={sampleBaseConfig({ views })}
                />
            </div>
        )
    },
}

/** Base-owned numeric chart (the default: no `source:`, so the base file's own row table IS the
 *  data — no daily notes required). Rows live in a signal the story's own `onSetDay` mutates, so
 *  clicking an empty day, typing a value and pressing Enter visibly fills the square — a no-op
 *  callback would look identical to a broken one here. */
export const EditableValues: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Journal', x: 'date', y: 'words' },
        ]
        const basePath = 'Journal.md'
        const today = todayISO()
        const [rows, setRows] = createSignal<Row[]>(
            [0, -1, -3, -4].map((offset, i) =>
                baseRow(i, addDaysISO(today, offset), basePath, 60 + i * 40),
            ),
        )
        const result = createMemo(() =>
            runView(sampleBaseConfig({ views }), rows(), 0),
        )
        const writes: HeatmapWriteSeam = {
            origin: 'base',
            isCount: false,
            onSetDay: async (date, value) => {
                setRows(prev => {
                    const idx = prev.findIndex(r => r.note.date === date)
                    if (idx === -1) {
                        if (value === undefined || value === 0) return prev
                        return [...prev, baseRow(prev.length, date, basePath, value)]
                    }
                    if (value === undefined || value === 0)
                        return prev.filter((_, i) => i !== idx)
                    return prev.map((r, i) =>
                        i === idx ? { ...r, note: { ...r.note, words: value } } : r,
                    )
                })
            },
            onToggleDay: async () => {},
        }
        return (
            <HeatmapView
                result={result()}
                config={sampleBaseConfig({ views })}
                writes={writes}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const today = todayISO()
        const emptyDay = addDaysISO(today, -2)
        let cell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${emptyDay}"]`,
            )
            if (!el) throw new Error('empty-day cell not yet rendered')
            return el
        })
        expect(cell.textContent).toBe('.')
        cell.click()
        const input = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLInputElement>('input')
            if (!el) throw new Error('day editor not yet open')
            return el
        })
        input.value = '42'
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        )
        await waitFor(() => {
            cell = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${emptyDay}"]`,
            )!
            if (cell.textContent === '.') throw new Error('square not filled yet')
            return cell
        })
        expect(cell.textContent).not.toBe('.')
        cell.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
        await waitFor(() => {
            const readout = canvasElement.querySelector('[class*="active"]')
            if (!readout || !readout.textContent?.includes('42'))
                throw new Error('readout does not show the saved value yet')
            return readout
        })
    },
}

/** Base-owned COUNT chart (no `y` — the view counts rows, not a value): clicking a day toggles it
 *  on (creates a row) or off (deletes every row on that day) rather than opening a number field. */
export const ToggleDays: Story = {
    render: () => {
        const views = [{ type: 'heatmap' as const, name: 'Habit', x: 'date' }]
        const basePath = 'Habit.md'
        const today = todayISO()
        const [rows, setRows] = createSignal<Row[]>(
            [0, -1, -2].map((offset, i) => baseRow(i, addDaysISO(today, offset), basePath)),
        )
        const result = createMemo(() =>
            runView(sampleBaseConfig({ views }), rows(), 0),
        )
        const writes: HeatmapWriteSeam = {
            origin: 'base',
            isCount: true,
            onSetDay: async () => {},
            onToggleDay: async date => {
                setRows(prev => {
                    const hasDay = prev.some(r => r.note.date === date)
                    if (!hasDay) return [...prev, baseRow(prev.length, date, basePath)]
                    return prev
                        .filter(r => r.note.date !== date)
                        .map((r, i) => ({ ...r, index: i }))
                })
            },
        }
        return (
            <HeatmapView
                result={result()}
                config={sampleBaseConfig({ views })}
                writes={writes}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const today = todayISO()
        const emptyDay = addDaysISO(today, -5)
        let cell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${emptyDay}"]`,
            )
            if (!el) throw new Error('cell not yet rendered')
            return el
        })
        expect(cell.textContent).toBe('.')
        cell.click()
        await waitFor(() => {
            cell = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${emptyDay}"]`,
            )!
            if (cell.textContent === '.') throw new Error('square not toggled on yet')
            return cell
        })
        expect(cell.textContent).not.toBe('.')
        cell.click()
        await waitFor(() => {
            cell = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${emptyDay}"]`,
            )!
            if (cell.textContent !== '.') throw new Error('square not toggled off yet')
            return cell
        })
        expect(cell.textContent).toBe('.')
    },
}

/** Query-sourced chart (rows come from a notes source, so squares map to notes — `Row.index` is
 *  undefined). A day with exactly one note edits its `words` property directly; an empty day has
 *  nowhere to write, so a click only surfaces why, via the readout/drill message. */
export const QuerySource: Story = {
    render: () => {
        const views = [
            { type: 'heatmap' as const, name: 'Writing streak', x: 'date', y: 'words' },
        ]
        const today = todayISO()
        const [rows, setRows] = createSignal<Row[]>([
            entryRow(0, today, 180),
        ])
        const result = createMemo(() =>
            runView(sampleBaseConfig({ views }), rows(), 0),
        )
        const writes: HeatmapWriteSeam = {
            origin: 'query',
            isCount: false,
            onSetDay: async (date, value) => {
                if (value === undefined) return
                setRows(prev =>
                    prev.map(r =>
                        r.note.date === date ? { ...r, note: { ...r.note, words: value } } : r,
                    ),
                )
            },
            onToggleDay: async () => {},
        }
        return (
            <HeatmapView
                result={result()}
                config={sampleBaseConfig({ views })}
                writes={writes}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const today = todayISO()
        // The one-note day edits directly.
        let cell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${today}"]`,
            )
            if (!el) throw new Error('one-note cell not yet rendered')
            return el
        })
        cell.click()
        const input = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLInputElement>('input')
            if (!el) throw new Error('day editor not yet open')
            return el
        })
        input.value = '260'
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
        )
        await waitFor(() => {
            cell = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${today}"]`,
            )!
            return cell
        })
        // An empty day has no note to edit — clicking shows the drill/readout message instead
        // of an editor, and no input should appear.
        const emptyDay = addDaysISO(today, -3)
        const emptyCell = await waitFor(() => {
            const el = canvasElement.querySelector<HTMLElement>(
                `[data-bucket="${emptyDay}"]`,
            )
            if (!el) throw new Error('empty-day cell not yet rendered')
            return el
        })
        emptyCell.click()
        await waitFor(() => {
            const clear = Array.from(
                canvasElement.querySelectorAll('button'),
            ).find(b => b.textContent?.includes('clear'))
            if (!clear) throw new Error('drill not yet open for the empty day')
            return clear
        })
        expect(canvasElement.textContent).toContain('no note on')
    },
}
