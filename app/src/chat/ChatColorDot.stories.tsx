// Visual spec for <ChatColorDot> — the swatch dot used in a chat tab's Color submenu (App.tsx's
// openTabContextMenu). See ChatColorDot.tsx for why this is its own component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ChatColorDot from './ChatColorDot'
import { Row } from '../ui/_storyKit'
import { CHAT_COLOR_SWATCHES } from './chatColors'

const meta = {
    title: 'Chat/ChatColorDot',
    component: ChatColorDot,
    parameters: { layout: 'centered' },
    argTypes: {
        color: { control: 'color' },
        none: { control: 'boolean' },
    },
    args: {
        color: '#e0a030',
        none: false,
    },
} satisfies Meta<typeof ChatColorDot>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single dot. */
export const Playground: Story = {
    render: args => (
        <Row label="colour dot" gap="10px">
            <ChatColorDot {...args} />
        </Row>
    ),
    // The defect this guards: the dot's own stylesheet set width/height on an inline span with no
    // `display`, so the frame held a zero-size element and looked blank while "rendering" fine. Assert
    // the box and the paint, not just that a node exists.
    play: async ({ canvasElement }) => {
        const dot = canvasElement.querySelector('span[data-size]') as HTMLElement
        expect(dot).not.toBeNull()
        const r = dot.getBoundingClientRect()
        expect(r.width).toBeGreaterThan(0)
        expect(r.height).toBeGreaterThan(0)
        expect(Math.round(r.width)).toBe(10)
        expect(getComputedStyle(dot).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    },
}

/** Every swatch the Color submenu actually offers, plus the "none"/Reset ring. */
export const AllSwatches: Story = {
    render: () => (
        <Row label="Color submenu swatches" gap="10px">
            {CHAT_COLOR_SWATCHES.map(sw => (
                <ChatColorDot color={sw.value} />
            ))}
            <ChatColorDot none />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const dots = [...canvasElement.querySelectorAll('span[data-size]')]
        expect(dots.length).toBe(CHAT_COLOR_SWATCHES.length + 1)
        for (const d of dots) {
            const r = d.getBoundingClientRect()
            expect(r.width).toBeGreaterThan(0)
            expect(r.height).toBeGreaterThan(0)
        }
        // every filled swatch paints; the last ("none") is hollow, its ring carrying the mark
        for (const d of dots.slice(0, -1))
            expect(getComputedStyle(d).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        const none = dots[dots.length - 1]!
        expect(getComputedStyle(none).backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(getComputedStyle(none).boxShadow).not.toBe('none')
    },
}
