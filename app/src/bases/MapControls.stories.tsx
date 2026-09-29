// Visual spec for <MapControls> — the floating map chrome: zoom/reset/fit top-right, Add pin
// top-left. Each story gives it a map-sized relative stage, as MapView does.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, within, userEvent } from 'storybook/test'
import MapControls, { type MapControlsProps } from './MapControls'

const meta = {
    title: 'Bases/MapControls',
    component: MapControls,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MapControls>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}
const base: MapControlsProps = {
    armed: false,
    blockedReason: null,
    onZoomIn: noop,
    onZoomOut: noop,
    onReset: noop,
    onFit: noop,
    onAddPin: noop,
}

function Stage(props: MapControlsProps) {
    return (
        <div
            style={{
                position: 'relative',
                height: '220px',
                width: '420px',
                border: 'var(--rule)',
            }}
        >
            <MapControls {...props} />
        </div>
    )
}

/** Static: everything enabled. */
export const Default: Story = {
    args: base,
    render: args => <Stage {...args} />,
}

/** Read-only map (no `basePath`): `Add pin` is disabled and its title says why. */
export const ReadOnly: Story = {
    args: {
        ...base,
        blockedReason: "Pins can't be added: this map is not backed by a base file",
    },
    render: args => <Stage {...args} />,
    play: async ({ canvasElement }) => {
        const add = within(canvasElement).getByTestId('map-add-pin')
        expect(add).toBeDisabled()
        expect(add.getAttribute('title')).toContain('not backed by a base file')
    },
}

/** Armed: `Add pin` is selected and reads as a cancel. Real state — pressing it toggles. */
export const ArmedToggle: Story = {
    args: base,
    render: args => {
        const [armed, setArmed] = createSignal(false)
        return (
            <Stage {...args} armed={armed()} onAddPin={() => setArmed(!armed())} />
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const add = c.getByTestId('map-add-pin')
        expect(add.getAttribute('aria-pressed')).toBe('false')
        await userEvent.click(add)
        expect(add.getAttribute('aria-pressed')).toBe('true')
        expect(add.getAttribute('title')).toContain('Cancel placing pin')
        await userEvent.click(add)
        expect(add.getAttribute('aria-pressed')).toBe('false')
    },
}
