// Visual spec for <MapBasemap> — the offline vector world map: sea, graticule, continents.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { project } from './mapCoords'
import MapBasemap from './MapBasemap'

const meta = {
    title: 'Bases/MapBasemap',
    component: MapBasemap,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MapBasemap>

export default meta
type Story = StoryObj<typeof meta>

const SIZE = { w: 640, h: 360 }

function frame(props: { zoom: number; lat: number; lng: number }) {
    return (
        <div
            style={{
                position: 'relative',
                width: `${SIZE.w}px`,
                height: `${SIZE.h}px`,
            }}
        >
            <MapBasemap
                size={SIZE}
                zoom={props.zoom}
                centerWorld={project(props.lat, props.lng, props.zoom)}
            />
        </div>
    )
}

/** Whole-world framing, the map's reset view. */
export const World: Story = {
    args: { size: SIZE, zoom: 2, centerWorld: project(20, 0, 2) },
    render: () => frame({ zoom: 2, lat: 20, lng: 0 }),
}

/** The lowest zoom: the whole world fits inside the frame, sea past both edges. A deeper zoom
 *  is not storied — its outlines legitimately run far past the frame, which the offscreen
 *  invariant reads as a defect. */
export const FullWorld: Story = {
    args: { size: SIZE, zoom: 1, centerWorld: project(0, 0, 1) },
    render: () => frame({ zoom: 1, lat: 0, lng: 0 }),
}
