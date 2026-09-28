// Visual spec for <MapView> — the offline vector world-map renderer. `sampleViewResult`'s
// curated dataset has no lat/lng, so this story mints its own small "places" dataset (real
// FileMeta shape) with valid coordinates, run through the real query engine so `result.columns`
// (marker label source) is genuine.
//
// Placement/move/remove writes (Task F) go through `api.setProperties`/`api.rowUpdate`, so the
// interactive stories below seed `setTransport(fakeTransport(...))` — a real write against a
// live backend has nothing to hit in Storybook, and the fake gives every mutation a 200 ack.
// A pin mid-drag is pointer-position state, not storyable; these instead cover the two states
// the brief calls out: the unplaced-rows menu with placement armed, and a pin's own menu.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createMemo, createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import type { Row } from '../../../core/src/bases/types'
import { MapView } from './MapView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { setTransport } from '../api'
import { fakeTransport } from '../ui/_fakeTransport'
import {
    addPinByMouse,
    editPinByMouse,
    placeUnplacedByMouse,
} from './_mapPinPlay'

const meta = {
    title: 'Bases/MapView',
    component: MapView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MapView>

export default meta
type Story = StoryObj<typeof meta>

function placeRow(name: string, note: Record<string, unknown>): Partial<Row> {
    return {
        file: {
            name,
            basename: name,
            path: `places/${name}.md`,
            folder: 'places',
            ext: 'md',
            size: 512,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note,
    }
}

const PLACES: Partial<Row>[] = [
    placeRow('Tokyo', { lat: 35.6762, lng: 139.6503 }),
    placeRow('Nairobi', { lat: -1.2921, lng: 36.8219 }),
    placeRow('Reykjavik', { lat: 64.1466, lng: -21.9426 }),
    placeRow('Buenos Aires', { lat: -34.6037, lng: -58.3816 }),
    placeRow('Vancouver', { lat: 49.2827, lng: -123.1207 }),
]

/** Default `lat`/`lng` property names — markers auto-fit + center on the bounding box of all
 *  five sample places (no explicit `zoom`/`center`, so MapView computes the framing itself). */
export const Default: Story = {
    render: () => {
        const views = [{ type: 'map' as const, name: 'Atlas' }]
        return (
            <div style={{ height: '480px' }}>
                <MapView
                    result={sampleViewResult(PLACES, { views })}
                    config={sampleBaseConfig({ views })}
                />
            </div>
        )
    },
}

/** Custom `lat`/`lng` field names + a fixed `center`/`zoom` — bypasses auto-fit entirely
 *  (per map.md, both must be present together) to open pre-centered on one city. */
export const CustomFieldsFixedFraming: Story = {
    render: () => {
        const views = [
            {
                type: 'map' as const,
                name: 'Atlas',
                lat: 'latitude',
                lng: 'longitude',
                center: { lat: 40.7128, lng: -74.006 },
                zoom: 4,
            },
        ]
        const rows: Partial<Row>[] = [
            placeRow('New York', { latitude: 40.7128, longitude: -74.006 }),
            placeRow('Boston', { latitude: 42.3601, longitude: -71.0589 }),
            placeRow('Washington DC', {
                latitude: 38.9072,
                longitude: -77.0369,
            }),
        ]
        return (
            <div style={{ height: '480px' }}>
                <MapView
                    result={sampleViewResult(rows, { views })}
                    config={sampleBaseConfig({ views })}
                />
            </div>
        )
    },
}

/** Some rows have no valid `lat`/`lng` — they show up in the "[N unplaced]" control instead
 *  of silently vanishing. `play()` opens that menu and picks one, arming placement: the map
 *  now shows a "placing … — esc to cancel" hint that follows the cursor, and the next click
 *  on the map would write that row's coordinates. */
export const UnplacedRowsArmed: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        const views = [{ type: 'map' as const, name: 'Atlas' }]
        const rows: Partial<Row>[] = [
            ...PLACES,
            placeRow('Unmapped Cafe', {}), // no lat/lng at all
            placeRow('Bad Coords', { lat: 'north-ish', lng: 12 }), // unparseable lat
        ]
        return (
            <div style={{ height: '480px' }}>
                <MapView
                    result={sampleViewResult(rows, { views })}
                    config={sampleBaseConfig({ views })}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const body = within(canvasElement.ownerDocument.body)

        const unplacedButton = await canvas.findByTestId('map-unplaced-button')
        expect(unplacedButton).toHaveTextContent('2 unplaced')
        await userEvent.click(unplacedButton)

        const option = await body.findByText('Unmapped Cafe')
        await userEvent.click(option)

        const hint = await canvas.findByText(/placing Unmapped Cafe/)
        expect(hint).toBeVisible()
    },
}

/** Right-clicking a placed pin (or Shift+F10 while it's focused) opens its own menu:
 *  edit (the row editor a left-click also opens), move pin (re-arms placement for that row),
 *  or remove pin (clears its coordinates — the row itself stays). */
export const PinMenuOpen: Story = {
    render: () => {
        setTransport(fakeTransport({}))
        const views = [{ type: 'map' as const, name: 'Atlas' }]
        return (
            <div style={{ height: '480px' }}>
                <MapView
                    result={sampleViewResult(PLACES, { views })}
                    config={sampleBaseConfig({ views })}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const body = within(canvasElement.ownerDocument.body)
        const pin = canvasElement.querySelector(
            '[class*="mapPin"]',
        ) as HTMLElement
        pin.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 100,
                clientY: 100,
            }),
        )
        expect(await body.findByText('edit')).toBeVisible()
        expect(await body.findByText('move pin')).toBeVisible()
        expect(await body.findByText('remove pin')).toBeVisible()
    },
}

/** A map over REAL state: the fake transport writes into these same row objects (and creates
 *  new notes beside them in `places/`), and `onChange` (BaseView wires `refetchAll` there in the
 *  app) re-runs the view over them — so a created row, a placed pin and a renamed title all show.
 *  `basePath` is what lets `Add pin` create a row at all. */
function LiveMap(props: { rows: Partial<Row>[] }) {
    const rows = props.rows.map(r => ({ ...r, note: { ...r.note } }))
    setTransport(fakeTransport({ rows: rows as Row[] }))
    const views = [{ type: 'map' as const, name: 'Atlas' }]
    const [tick, setTick] = createSignal(0)
    const result = createMemo(() => {
        tick()
        return sampleViewResult(rows, { views })
    })
    return (
        <div style={{ height: '480px' }}>
            <MapView
                result={result()}
                config={sampleBaseConfig({ views })}
                basePath="places/Places.md"
                onChange={() => setTick(t => t + 1)}
            />
        </div>
    )
}

const WITH_UNPLACED: Partial<Row>[] = [
    ...PLACES,
    placeRow('Unmapped Cafe', {}),
    placeRow('Bad Coords', { lat: 'north-ish', lng: 12 }),
]

/** `Add pin` creates a NEW row where you click and opens its editor. `play()` drives it with the
 *  event sequence a real mouse produces, jitter included (pointerdown → mousedown → a 1–3px move
 *  → pointerup → mouseup → click): zoom in, press `Add pin`, press the map, name the row in the
 *  editor — and asserts the pin appears, carries the typed name, and that arming, creating and
 *  every refetch leave the user's zoom and centre exactly where they were. */
export const AddPin: Story = {
    render: () => <LiveMap rows={WITH_UNPLACED} />,
    play: async ({ canvasElement }) => {
        await addPinByMouse(canvasElement, 'Harbor Lookout')
    },
}

/** A left-click on a pin opens the row editor for THAT row (title + properties, `[open note]`);
 *  renaming it there changes the pin's label once the rows refetch. */
export const EditPin: Story = {
    render: () => <LiveMap rows={PLACES} />,
    play: async ({ canvasElement }) => {
        await editPinByMouse(canvasElement, 'Nairobi', 'Nairobi Office')
    },
}

/** `[N unplaced]` still places EXISTING rows that have no coordinates: pick one, press the map. */
export const PlaceUnplaced: Story = {
    render: () => <LiveMap rows={WITH_UNPLACED} />,
    play: async ({ canvasElement }) => {
        await placeUnplacedByMouse(canvasElement, 'Unmapped Cafe', 2)
    },
}
