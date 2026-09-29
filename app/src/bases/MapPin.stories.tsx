// Visual spec for <MapPin> — one pin: label chip over an accent "@" glyph. Every variant.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, within, userEvent } from 'storybook/test'
import MapPin, { type MapPinProps } from './MapPin'

const meta = {
    title: 'Bases/MapPin',
    component: MapPin,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MapPin>

export default meta
type Story = StoryObj<typeof meta>

/** A pin is absolutely positioned inside the map, so each story gives it a relative stage. */
function Stage(props: MapPinProps) {
    return (
        <div style={{ position: 'relative', height: '120px', width: '320px' }}>
            <MapPin {...props} />
        </div>
    )
}

const base = { title: 'Nairobi', x: 160, y: 90 }

/** An editable pin: a button. */
export const Default: Story = {
    args: base,
    render: args => <Stage {...args} hint="Click to edit" />,
}

/** Mid-drag: grabbing cursor. */
export const Dragging: Story = {
    args: { ...base, dragging: true },
    render: args => <Stage {...args} />,
}

/** A long title truncates inside the chip. */
export const LongTitle: Story = {
    args: {
        ...base,
        title: 'A very long place name that cannot fit inside the chip',
    },
    render: args => <Stage {...args} />,
}

/** Placement armed: the pin goes click-through so the click lands on the map. */
export const PassThrough: Story = {
    args: { ...base, passThrough: true },
    render: args => <Stage {...args} />,
}

/** A pin that cannot be edited (a map with no base file): the chip is a note link. */
export const ReadOnlyNoteLink: Story = {
    args: { ...base, notePath: 'places/Nairobi.md' },
    render: args => <Stage {...args} />,
    play: async ({ canvasElement }) => {
        const link = within(canvasElement).getByRole('link', { name: 'Nairobi' })
        let detail: unknown
        const on = (e: Event) => (detail = (e as CustomEvent).detail)
        window.addEventListener('bismuth-open', on)
        await userEvent.click(link)
        window.removeEventListener('bismuth-open', on)
        expect(detail).toBe('places/Nairobi.md')
    },
}

/** Clicking an editable pin calls its handler (real state, not a no-op). */
export const ClickCounts: Story = {
    args: base,
    render: args => {
        const [n, setN] = createSignal(0)
        return (
            <div>
                <Stage {...args} onClick={() => setN(n() + 1)} />
                <output data-testid="clicks">{n()}</output>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button'))
        expect(c.getByTestId('clicks').textContent).toBe('1')
    },
}
