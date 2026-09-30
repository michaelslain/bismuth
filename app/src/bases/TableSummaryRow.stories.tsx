import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TableSummaryRow from './TableSummaryRow'
import AsciiCellEdges from '../ui/ascii/AsciiCellEdges'

const meta = {
    title: 'Bases/TableSummaryRow',
    component: TableSummaryRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TableSummaryRow>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: unknown }) => (
    <div style={{ padding: '12px' }}>
        <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
            {props.children as never}
        </table>
    </div>
)

const BODY = ['first', 'second', 'third']

/** A body row typed as TableView types it: top + left per cell, the last column adds right.
 *  `top` is dropped for a row directly under the header, `bottom` added for the closing row. */
const BodyRow = (props: { top?: boolean; bottom?: boolean; label: string }) => (
    <tr>
        {BODY.map((c, i) => (
            <td
                style={{
                    position: 'relative',
                    padding: 'var(--sp-4) var(--sp-5)',
                    'box-sizing': 'border-box',
                    height: 'calc(var(--cell-h) * 2)',
                }}
            >
                {props.label} {c}
                <AsciiCellEdges
                    edges={[
                        'left',
                        ...(props.top === false ? [] : (['top'] as const)),
                        ...(i === BODY.length - 1 ? (['right'] as const) : []),
                        ...(props.bottom ? (['bottom'] as const) : []),
                    ]}
                />
            </td>
        ))}
    </tr>
)

/** One summary value under the columns that have one; the rest stay empty cells so the `=` rule
 *  above still spans the table. The body row above omits its bottom — the summary types its top. */
export const Default: Story = {
    render: () => (
        <Frame>
            <tbody>
                <BodyRow label="a" top={false} />
                <BodyRow label="b" />
            </tbody>
            <TableSummaryRow
                cols={['title', 'pages', 'rating']}
                summaries={{ 'note.pages': '1,240', 'note.rating': '4.2' }}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const cells = [...canvasElement.querySelectorAll('tfoot td')]
        expect(cells.length).toBe(3)
        // each summary cell types a heavy top, closes with left + bottom, and there is no 2px bar
        for (const c of cells) {
            expect(c.querySelector('[data-edges~="top"][data-heavy~="top"]')).toBeTruthy()
            expect(c.querySelector('[data-edges~="bottom"]')).toBeTruthy()
            expect(c.querySelector('[data-edges~="left"]')).toBeTruthy()
            expect(getComputedStyle(c).borderTopWidth).toBe('0px')
        }
        expect(cells[2]!.querySelector('[data-edges~="right"]')).toBeTruthy()
        expect(cells[0]!.querySelector('[data-edges~="right"]')).toBeNull()
        expect((cells[0].textContent ?? '').trim()).toBe('')
        expect(cells[1].textContent).toContain('1,240')
        expect(cells[2].textContent).toContain('4.2')
    },
}
