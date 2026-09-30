import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TableHeader from './TableHeader'
import AsciiCellEdges from '../ui/ascii/AsciiCellEdges'
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
        // The typed grid: each header hosts its own overlay, and there is no border-bottom rule.
        for (const th of ths) {
            expect(th.querySelector('[data-edges]')).toBeTruthy()
            expect(th.querySelector('[data-heavy~="bottom"]')).toBeTruthy()
            expect(getComputedStyle(th).borderBottomWidth).toBe('0px')
        }
        // Each header rings its glyph overhang (it is a sticky header), one ring per <th>.
        expect(canvasElement.querySelectorAll('[data-backdrop]').length).toBe(ths.length)
        for (const th of ths) expect(th.querySelector('[data-backdrop]')).toBeTruthy()
        // Only the last header closes the right edge.
        expect(ths[3].querySelector('[data-edges~="right"]')).toBeTruthy()
        expect(ths[0].querySelector('[data-edges~="right"]')).toBeNull()
    },
}

/** The header over one body row: the `=` under the labels is the header's own bottom, and the
 *  body row starts where the header ends. */
export const WithBodyRow: Story = {
    render: () => (
        <div style={{ padding: '12px' }}>
            <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
                <TableHeader cols={COLS} config={sampleBaseConfig()} />
                <tbody>
                    <tr>
                        {COLS.map((c, i) => (
                            <td
                                style={{
                                    position: 'relative',
                                    padding: 'var(--sp-4) var(--sp-5)',
                                    'box-sizing': 'border-box',
                                    height: 'calc(var(--cell-h) * 2)',
                                }}
                            >
                                {c} value
                                <AsciiCellEdges
                                    edges={
                                        i === COLS.length - 1
                                            ? ['left', 'right', 'bottom']
                                            : ['left', 'bottom']
                                    }
                                />
                            </td>
                        ))}
                    </tr>
                </tbody>
            </table>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const thEl = canvasElement.querySelector('th')!
        const tdEl = canvasElement.querySelector('td')!
        const th = thEl.getBoundingClientRect()
        const td = tdEl.getBoundingClientRect()
        // the body row starts where the header ends: one shared boundary, typed once
        expect(Math.abs(td.top - th.bottom)).toBeLessThanOrEqual(1)
        // typed once: the header owns the line (its bottom, heavy). Whether the first body row
        // omits its top is TableView's rule, asserted in TableView.stories.tsx Default.
        expect(thEl.querySelector('[data-edges~="bottom"]')).toBeTruthy()
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
