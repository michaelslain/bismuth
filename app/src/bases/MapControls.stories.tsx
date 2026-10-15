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

/** A token's resolved colour, read through a probe element so the assertion never hardcodes an rgb. */
const resolved = (root: HTMLElement, token: string) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${token})`
    root.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
}

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
    play: async ({ canvasElement }) => {
        const add = within(canvasElement).getByTestId('map-add-pin')
        expect(getComputedStyle(add).color).toBe(resolved(canvasElement, '--fg'))
    },
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
        expect(add.getAttribute('data-tooltip')).toContain('not backed by a base file')
        // Disabled reads as disabled: Button's `--faint`, not the enabled pin's full ink.
        expect(getComputedStyle(add).color).toBe(resolved(canvasElement, '--faint'))
    },
}

/** Armed: `Add pin` is selected and reads as a cancel. Real state — pressing it toggles. The story
 *  ends armed, so its resting frame shows the `[pin]` brackets. */
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
        expect(add.getAttribute('data-tooltip')).toContain('Cancel placing pin')
        await userEvent.click(add)
        expect(add.getAttribute('aria-pressed')).toBe('false')
        await userEvent.click(add)
        expect(add.getAttribute('aria-pressed')).toBe('true')
    },
}
