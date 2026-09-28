// Every Bases view kind at once, side by side — the surface for judging the twelve renderers as
// ONE family (bar, spacing, type, colour) rather than one story at a time. Each tile is a real
// `type: base` md file rendered by <BaseView>, so the bar, the view tabs and the resolution
// pipeline (`POST /rows` through the fake transport) are the same ones the app mounts.
//
// One fake transport serves every tile (setTransport is a module-level singleton), so the row
// set is chosen per SOURCE: a base scoped `from: "[[Places]]"` gets coordinates for the map,
// `from: "[[Vocab]]"` gets a front/back deck for flashcards, and everything else gets the curated
// SAMPLE_ROWS with `due` moved relative to today, so the charts, heatmap and calendar land on
// dates that are actually on screen whenever the story is opened. The calendar's events register
// reads its own base file over `api.read`, so its body is seeded into `files` as well.
import { onCleanup, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import { BaseView } from './BaseView'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'
import { Label } from '../ui/_storyKit'
import { settings, setSettings } from '../settings'
import type { Row, SourceSpec, ViewType } from '../../../core/src/bases/types'
import { todayISO, addDaysISO } from '../../../core/src/dates'

const meta = {
    title: 'Bases/Gallery',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const today = todayISO()

/** The curated dataset, re-dated around today (same order as SAMPLE_ROWS). */
const DUE_OFFSETS = [2, -3, -12, 5, 1, -20]
const PROJECT_ROWS: Row[] = SAMPLE_ROWS.map((row, i) => ({
    ...row,
    note: { ...row.note, due: addDaysISO(today, DUE_OFFSETS[i]) },
}))

function row(folder: string, name: string, note: Record<string, unknown>): Row {
    return {
        file: {
            name,
            basename: name,
            path: `${folder}/${name}.md`,
            folder,
            ext: 'md',
            size: 256,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note,
        formula: {},
    }
}

const PLACE_ROWS: Row[] = [
    row('places', 'Tokyo', { lat: 35.6762, lng: 139.6503 }),
    row('places', 'Nairobi', { lat: -1.2921, lng: 36.8219 }),
    row('places', 'Reykjavik', { lat: 64.1466, lng: -21.9426 }),
    row('places', 'Buenos Aires', { lat: -34.6037, lng: -58.3816 }),
    row('places', 'Vancouver', { lat: 49.2827, lng: -123.1207 }),
]

const VOCAB_ROWS: Row[] = [
    row('vocab', 'card-1', { front: 'capital of France', back: 'Paris', due: today }),
    row('vocab', 'card-2', {
        front: 'capital of Japan',
        back: 'Tokyo',
        due: addDaysISO(today, -3),
    }),
    row('vocab', 'card-3', { front: 'capital of Kenya', back: 'Nairobi', due: null }),
    row('vocab', 'card-4', {
        front: 'capital of Iceland',
        back: 'Reykjavik',
        due: addDaysISO(today, 14),
    }),
]

function rowsFor(spec: SourceSpec): Row[] {
    const from = spec.kind === 'base' ? undefined : spec.from
    if (from === '[[Places]]') return PLACE_ROWS
    if (from === '[[Vocab]]') return VOCAB_ROWS
    return PROJECT_ROWS
}

/** The calendar's events register reads the base file's own event table, not `/rows`. */
const CALENDAR_EVENTS = [
    ['e1', 'Roadmap review', 0, '10:00', '11:00'],
    ['e2', 'Design crit', 1, '14:00', '15:30'],
    ['e3', 'Vendor call', -1, '09:00', '09:30'],
    ['e4', 'Retro', 3, '16:00', '17:00'],
] as const

type Tile = {
    type: ViewType
    /** The view's own YAML lines under `- type: <kind>`, indented four spaces. */
    view?: string[]
    /** Base-level `source.from`, when the kind needs a different dataset. */
    from?: string
    /** Anything after the frontmatter (the calendar's event table). */
    table?: string[]
    /** Base-level `formulas:` lines, indented two spaces — the line tile's y plots one, so the
     *  KaTeX definition gets its `formula.*` appendix and the chart shows real computed numbers,
     *  not just a raw column. */
    formulas?: string[]
}

const TILES: Tile[] = [
    { type: 'table' },
    { type: 'cards' },
    { type: 'list' },
    { type: 'bullets' },
    { type: 'kanban', view: ['groupBy: status'] },
    { type: 'map', from: '[[Places]]' },
    {
        type: 'calendar',
        table: [
            '| id | title | date | startTime | endTime | location | link | description | category | recurrence |',
            '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
            ...CALENDAR_EVENTS.map(
                ([id, title, offset, start, end]) =>
                    `| ${id} | ${title} | ${addDaysISO(today, offset)} | ${start} | ${end} |  |  |  |  |  |`,
            ),
        ],
    },
    { type: 'flashcards', from: '[[Vocab]]' },
    { type: 'bar', view: ['x: status', 'aggregate: count'] },
    {
        type: 'line',
        formulas: ['weighted: priority * 2'],
        view: ['x: due', 'y: formula.weighted', 'aggregate: sum', 'bin: week'],
    },
    {
        type: 'stat',
        view: [
            'stats:',
            '  - { label: total priority, value: sum(priority) }',
            '  - { label: average priority, value: avg(priority) }',
        ],
    },
    { type: 'heatmap', view: ['x: due'] },
]

const pathOf = (t: Tile) => `gallery/${t.type}.md`

function bodyOf(t: Tile): string {
    return [
        '---',
        'type: base',
        ...(t.from ? ['source:', '  kind: notes', `  from: "${t.from}"`] : []),
        ...(t.formulas ? ['formulas:', ...t.formulas.map(l => `  ${l}`)] : []),
        'views:',
        `  - type: ${t.type}`,
        `    name: ${t.type[0].toUpperCase()}${t.type.slice(1)}`,
        ...(t.view ?? []).map(line => `    ${line}`),
        '---',
        ...(t.table ? ['', ...t.table] : []),
        '',
    ].join('\n')
}

function seed(): void {
    setTransport(
        fakeTransport({
            rows: rowsFor,
            files: Object.fromEntries(TILES.map(t => [pathOf(t), bodyOf(t)])),
        }),
    )
}

/** A sized stand-in for an editor pane: BaseView fills its host, and the map, calendar and
 *  flashcards stage only lay out inside a bounded box. */
function Pane(props: { tile: Tile; width: string; height: string }): JSX.Element {
    return (
        <div
            data-testid={`gallery-${props.tile.type}`}
            style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '6px',
                'min-width': '0',
            }}
        >
            <Label>{props.tile.type}</Label>
            <div
                style={{
                    width: props.width,
                    height: props.height,
                    display: 'flex',
                    'flex-direction': 'column',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    background: 'var(--bg)',
                }}
            >
                <BaseView path={pathOf(props.tile)} body={bodyOf(props.tile)} />
            </div>
        </div>
    )
}

/** In the app every pane IS the viewport, so global.css can set `overscroll-behavior: none` on every
 *  element (it stops the window rubber-banding) and nothing ever needs to chain a scroll outward.
 *  Here twelve panes sit inside one scrolling page, and each BaseView root is an `overflow: auto`
 *  box — with chaining off, a wheel over ANY tile dies there, even one with nothing to scroll, and
 *  the page cannot be scrolled at all. Restoring chaining inside the tiles is a property of this
 *  harness, not of the views. (The map still keeps the wheel: it zooms.) */
const CHAIN_SCROLL = '[data-gallery] * { overscroll-behavior: auto }'

/** One kind per row at full width, each at an editor pane's height, so every view is usable —
 *  scroll, click, review a card — rather than a thumbnail of itself. */
function Gallery(): JSX.Element {
    seed()
    // Month shows every seeded event in one tile; the week grid opens at midnight with them below
    // the fold. CalendarView re-applies the saved default on every mount, so the setting is the
    // seam — a click on `month` would focus the button and jump the page to the calendar.
    const prevView = settings.calendar.defaultView
    setSettings('calendar', 'defaultView', 'month')
    onCleanup(() => setSettings('calendar', 'defaultView', prevView))
    return (
        <div
            data-gallery
            style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: '32px',
                padding: '16px',
                background: 'var(--bg)',
            }}
        >
            <style>{CHAIN_SCROLL}</style>
            {TILES.map(tile => (
                <Pane {...{ tile }} width="100%" height="640px" />
            ))}
        </div>
    )
}

/** Every tile mounted, and each of the three datasets reached its tile — a tile that fell back to
 *  the wrong rows (or none) would miss its own marker text. */
async function allTilesResolved({ canvasElement }: { canvasElement: HTMLElement }) {
    const canvas = within(canvasElement)
    for (const t of TILES) expect(canvas.getByTestId(`gallery-${t.type}`)).toBeInTheDocument()
    await waitFor(() => {
        const table = within(canvas.getByTestId('gallery-table'))
        expect(table.getByText('Draft the roadmap')).toBeInTheDocument()
        const map = within(canvas.getByTestId('gallery-map'))
        expect(map.getAllByText('Tokyo').length).toBeGreaterThan(0)
        const cards = within(canvas.getByTestId('gallery-flashcards'))
        expect(cards.getAllByText('capital of France').length).toBeGreaterThan(0)
    })
    const calendar = within(canvas.getByTestId('gallery-calendar'))
    await waitFor(() => expect(calendar.getByText('Roadmap review')).toBeInTheDocument())
    // Nothing on mount may move the page: the gallery opens at its first tile.
    expect(canvasElement.ownerDocument.defaultView?.scrollY).toBe(0)
}

/** Every kind, stacked one per row — the one to judge the family from and to try each view in. */
export const AllKinds: Story = {
    render: () => <Gallery />,
    play: allTilesResolved,
}
