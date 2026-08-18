// Visual spec for <MapView> — the offline vector world-map renderer. `sampleViewResult`'s
// curated dataset has no lat/lng, so this story mints its own small "places" dataset (real
// FileMeta shape) with valid coordinates, run through the real query engine so `result.columns`
// (marker label source) is genuine.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { Row } from '../../../core/src/bases/types'
import { MapView } from './MapView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

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
                    onOpen={() => {}}
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
                    onOpen={() => {}}
                />
            </div>
        )
    },
}
