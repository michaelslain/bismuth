// Visual spec for <AsciiChart> — a row of typed bars, the system's only chart. Split out of
// AsciiMeter.stories.tsx when the chart got its own component and stylesheet.
//
// Props: series ({ label, value, color? }[]), width? (cells, default 16), class?.
// Bars scale against the largest value; a non-zero value always draws at least one `#` (3 against
// 118 is not zero); the numerals are right-aligned so magnitudes compare down the column.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import AsciiChart from './AsciiChart'
import { Row } from '../_storyKit'

const meta = {
    title: 'UI/Ascii/AsciiChart',
    component: AsciiChart,
    parameters: { layout: 'centered' },
    argTypes: { width: { control: 'number' } },
} satisfies Meta<typeof AsciiChart>

export default meta
type Story = StoryObj<typeof meta>

/** The chart's rows: the siblings of the row whose own text starts the first label. */
const rows = (root: HTMLElement) => {
    const first = [...root.querySelectorAll<HTMLElement>('div')].find(d =>
        [...d.childNodes].some(n => n.nodeType === Node.TEXT_NODE && /^attention/.test(n.textContent ?? '')),
    )
    return [...(first?.parentElement?.children ?? [])] as HTMLElement[]
}

/** The `drift 3` row is the reason the floor exists: round(3 / 118 * 16) is 0, which drew no bar and
 *  read as zero. It now draws one `#`; the numerals are right-aligned (`  3`, ` 40`, `118`); and the
 *  rows sit on the 18px row unit instead of touching at 10.5px. */
export const Chart: Story = {
    args: {
        series: [
            { label: 'attention', value: 118, color: 'var(--graph-0)' },
            { label: 'recall', value: 40, color: 'var(--graph-1)' },
            { label: 'drift', value: 3 },
        ],
    },
    play: async ({ canvasElement }) => {
        const lines = rows(canvasElement)
        expect(lines.length).toBe(3)
        const bars = lines.map(l => (l.textContent ?? '').match(/#+/)?.[0].length ?? 0)
        expect(bars, 'bar lengths: 118 fills the width, 40 a third, 3 is one cell and not none').toEqual([16, 5, 1])
        // numerals right-aligned: every line ends with the same-width number field, so the last
        // character of each line is at one x (the digits' right edge)
        const right = lines.map(l => {
            const range = document.createRange()
            range.selectNodeContents(l)
            return range.getBoundingClientRect().right
        })
        for (const x of right) expect(Math.abs(x - right[0]!)).toBeLessThan(0.5)
        // rows breathe: one app row unit apart, never touching
        const tops = lines.map(l => l.getBoundingClientRect().top)
        const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
        expect(tops[1]! - tops[0]!).toBeGreaterThanOrEqual(rowH - 0.5)
        expect(tops[2]! - tops[1]!).toBeGreaterThanOrEqual(rowH - 0.5)
    },
}

/** Single-item and empty-series edge cases. */
export const EdgeCases: Story = {
    render: () => (
        <Row column gap="12px">
            <AsciiChart series={[{ label: 'solo', value: 7 }]} />
            <AsciiChart series={[{ label: 'none', value: 0 }, { label: 'one', value: 1 }]} />
            <AsciiChart series={[]} />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const text = canvasElement.textContent ?? ''
        expect(text).toContain('solo ################ 7')
        // an actual zero draws no bar; a non-zero one draws one even when it is the whole scale
        expect(text).toMatch(/none\s{18}0/)
    },
}
