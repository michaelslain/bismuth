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
import { disarmFakeServerVersion, fakeServerVersionArmed, fakeTransport } from '../ui/_fakeTransport'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'
import { Label } from '../ui/_storyKit'
import { addPinByMouse } from './_mapPinPlay'
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

// Two rows deliberately carry no lat/lng — the map's own "unplaced (N)" control needs at
// least one to open, and MapPinsLand's play() drops N from 2 to 1 by placing one of them,
// which asserting `unplaced (1)` still visible needs a second unplaced row left over.
const PLACE_ROWS: Row[] = [
    row('places', 'Tokyo', { lat: 35.6762, lng: 139.6503 }),
    row('places', 'Nairobi', { lat: -1.2921, lng: 36.8219 }),
    row('places', 'Reykjavik', { lat: 64.1466, lng: -21.9426 }),
    row('places', 'Buenos Aires', { lat: -34.6037, lng: -58.3816 }),
    row('places', 'Vancouver', { lat: 49.2827, lng: -123.1207 }),
    row('places', 'Cairo', {}),
    row('places', 'Lima', {}),
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

/** A fresh, deep copy of every dataset — the gallery's mutable row store for ONE mount. The
 *  fake transport writes edits into these objects, so copying per mount keeps a pin placed (or a
 *  box ticked) in one story from leaking into the next: Storybook's preview iframe keeps module
 *  state across story switches, and `MapPinsLand` asserts the starting `unplaced (2)`. */
function freshRows(): (spec: SourceSpec) => Row[] {
    const copy = (rows: Row[]) => JSON.parse(JSON.stringify(rows)) as Row[]
    const places = copy(PLACE_ROWS)
    const vocab = copy(VOCAB_ROWS)
    const projects = copy(PROJECT_ROWS)
    return spec => {
        const from = spec.kind === 'base' ? undefined : spec.from
        if (from === '[[Places]]') return places
        if (from === '[[Vocab]]') return vocab
        return projects
    }
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
    { type: 'line' },
    { type: 'stat' },
    { type: 'heatmap', view: ['x: due'] },
]

const pathOf = (t: Tile) => `gallery/${t.type}.md`

function bodyOf(t: Tile): string {
    return [
        '---',
        'type: base',
        ...(t.from ? ['source:', '  kind: notes', `  from: "${t.from}"`] : []),
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
            rows: freshRows(),
            // Every write bumps the server version the way the real server does, so a view's
            // `onChange` refetch leaves BaseView's version-gated row cache and shows the edit.
            versioned: true,
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
    // seed() armed the fake server version for every versioned tile above — release it on
    // unmount so the next story's own `startServerVersion` call is not a silent no-op against
    // an owner this gallery never let go of (see `disarmFakeServerVersion`'s doc comment).
    onCleanup(disarmFakeServerVersion)
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

/** Proves the gallery's fake transport holds REAL state, not a canned ack, AND that the map's
 *  add-pin flow works for a real mouse: zoom in, press the map's `Add pin` control, pick Cairo,
 *  press an empty spot — every step dispatched as the full pointerdown → mousedown → pointerup →
 *  mouseup → click sequence at one point (see `_mapPinPlay.ts`; an earlier version dispatched a
 *  lone synthetic `click` and passed while the user's real clicks did nothing). The write goes
 *  through `/set-properties` into the SAME `PLACE_ROWS` objects `/rows` resolved from, and
 *  `onChange={refetchAll}` (wired in BaseView) re-resolves them — so a new pin appears and the
 *  unplaced count drops, with no manual re-render — while the zoom and centre the user chose
 *  survive arming, placing and that refetch. The refetch only reaches the transport because
 *  the write also bumps the server version (`versioned: true`); otherwise BaseView's
 *  version-gated row cache answers it with the pre-write rows. */
async function mapPinLands({ canvasElement }: { canvasElement: HTMLElement }) {
    // The bump rides a poll callback captured from `serverVersion.start()`. Uncaptured, every
    // bump is a silent no-op and this story would fail for the wrong reason — or, against a
    // cache that happened to be cold, pass without proving anything.
    expect(fakeServerVersionArmed()).toBe(true)
    const pane = within(canvasElement).getByTestId('gallery-map')
    pane.scrollIntoView({ block: 'center' })
    await addPinByMouse(pane, 'Cairo', 2)
}

/** Same gallery, isolated to prove writes stick — see `mapPinLands` for what it checks and why. */
export const MapPinsLand: Story = {
    render: () => <Gallery />,
    play: mapPinLands,
}

/** A table tile has no optimistic state — a cell only changes once a refetch re-resolves the
 *  store — so ticking `done` and seeing the cell flip to `x` proves the write stuck.
 *
 *  A kanban drag is deliberately NOT a step here, though it was checked the same way: the drop
 *  batches `status` plus an `order` key onto every card in the column (`setProperties`), and the
 *  table tile's auto columns then gain an `order` column that widens it past the viewport inside
 *  its own scrolling pane — which the invariant sweep, blind to that clipping, reports as
 *  `overflows-viewport-x` on every run. */
async function editsStick({ canvasElement }: { canvasElement: HTMLElement }) {
    expect(fakeServerVersionArmed()).toBe(true)
    const table = within(canvasElement).getByTestId('gallery-table')
    await waitFor(() =>
        expect(within(table).getByText('Draft the roadmap')).toBeInTheDocument(),
    )
    const doneIdx = [...table.querySelectorAll('thead th')].findIndex(
        th => (th.textContent ?? '').trim().toLowerCase() === 'done',
    )
    expect(doneIdx).toBeGreaterThanOrEqual(0)
    const doneCell = () => {
        const tr = [...table.querySelectorAll('tbody tr')].find(r =>
            (r.textContent ?? '').includes('Investigate flaky test'),
        )!
        return tr.querySelectorAll<HTMLElement>('td')[doneIdx]!
    }
    expect((doneCell().textContent ?? '').trim()).toBe('')
    doneCell().querySelector<HTMLElement>('button')!.click()
    await waitFor(() => expect((doneCell().textContent ?? '').trim()).toBe('x'))
}

/** Same gallery, proving a table boolean toggle sticks — see `editsStick`. */
export const EditsStick: Story = {
    render: () => <Gallery />,
    play: editsStick,
}
