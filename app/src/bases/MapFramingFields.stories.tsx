// Visual spec for <MapFramingFields> — the map view's opening zoom + center.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import MapFramingFields, { type MapFraming } from './MapFramingFields'

const meta = {
    title: 'Bases/MapFramingFields',
    component: MapFramingFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof MapFramingFields>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: { initial: MapFraming }) {
    const [v, setV] = createSignal(p.initial)
    return (
        <div style={{ width: '460px' }}>
            <MapFramingFields value={v()} onChange={setV} />
        </div>
    )
}

export const FitToMarkers: Story = {
    render: () => (
        <Harness initial={{ zoom: '', centerLat: '', centerLng: '' }} />
    ),
}

export const FixedFrame: Story = {
    render: () => (
        <Harness initial={{ zoom: '6', centerLat: '40.7', centerLng: '-74' }} />
    ),
}
