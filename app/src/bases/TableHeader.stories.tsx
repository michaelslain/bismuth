import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TableHeader from './TableHeader'
import { sampleBaseConfig } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/TableHeader',
    component: TableHeader,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TableHeader>

export default meta
type Story = StoryObj<typeof meta>

const COLS = ['title', 'status', 'due', 'tags']

/** Plain headers: uppercase micro eyebrow, no drag or resize affordance. */
export const Static: Story = {
    render: () => (
        <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
            <TableHeader cols={COLS} config={sampleBaseConfig()} />
        </table>
    ),
    play: async ({ canvasElement }) => {
        const ths = canvasElement.querySelectorAll('th')
        expect(ths.length).toBe(4)
        expect(getComputedStyle(ths[0]).textTransform).toBe('uppercase')
        expect(getComputedStyle(ths[0]).cursor).not.toBe('grab')
        expect(canvasElement.querySelector('th [class*="thResize"]')).toBeNull()
    },
}

/** Reorderable + resizable, with the drop cue on the second header and the col-resize cursor
 *  on the third; the pointer callbacks are real (they report which header was pressed). */
export const Interactive: Story = {
    render: () => {
        const [pressed, setPressed] = createSignal(-1)
        return (
            <div>
                <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
                    <TableHeader
                        cols={COLS}
                        config={sampleBaseConfig()}
                        reorderable
                        resizable
                        overIdx={1}
                        edgeIdx={2}
                        onPointerDown={i => setPressed(i)}
                    />
                </table>
                <p data-testid="pressed">{pressed()}</p>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const ths = canvasElement.querySelectorAll('th')
        expect(getComputedStyle(ths[0]).cursor).toBe('grab')
        expect(getComputedStyle(ths[1]).boxShadow).not.toBe('none')
        expect(getComputedStyle(ths[2]).cursor).toBe('col-resize')
        ths[3].dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }),
        )
        await Promise.resolve()
        expect(
            canvasElement.querySelector('[data-testid="pressed"]')!.textContent,
        ).toBe('3')
    },
}
