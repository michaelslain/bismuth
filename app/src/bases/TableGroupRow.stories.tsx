import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TableGroupRow from './TableGroupRow'
import AsciiCellEdges from '../ui/ascii/AsciiCellEdges'

const meta = {
    title: 'Bases/TableGroupRow',
    component: TableGroupRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TableGroupRow>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: unknown }) => (
    <div style={{ padding: '12px' }}>
        <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
            <tbody>{props.children as never}</tbody>
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

/** The tinted band carrying `● LABEL // N` — the same header List, Cards and Bullets use — between
 *  body rows: it types top + left + right (no `|` through the label) and the row after it types
 *  its own top. */
export const Default: Story = {
    render: () => (
        <Frame>
            <BodyRow label="a" top={false} />
            <TableGroupRow label="doing" count={3} colspan={3} />
            <BodyRow label="b" bottom />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const td = canvasElement.querySelector('td[colspan]')!
        expect(td.getAttribute('colspan')).toBe('3')
        // a band: left + right bars, a top run, and no bottom run, no interior bar
        expect(td.querySelector('[class*="bar"][class*="left"]')).toBeTruthy()
        expect(td.querySelector('[class*="bar"][class*="right"]')).toBeTruthy()
        expect(td.querySelector('[class*="run"][class*="top"]')).toBeTruthy()
        expect(td.querySelector('[class*="bottom"]')).toBeNull()
        expect(getComputedStyle(td).borderBottomWidth).toBe('0px')
        expect(td.textContent).toContain('doing')
        expect(td.textContent).toContain('3')
        expect(parseFloat(getComputedStyle(td).paddingLeft)).toBeGreaterThan(0)
    },
}

/** Several bands in a row, each group coloured from its own label. */
export const Several: Story = {
    render: () => (
        <Frame>
            <TableGroupRow label="todo" count={4} colspan={3} first />
            <BodyRow label="a" />
            <TableGroupRow label="doing" count={2} colspan={3} />
            <BodyRow label="b" />
            <TableGroupRow label="done" count={11} colspan={3} />
            <BodyRow label="c" bottom />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelectorAll('td[colspan]').length).toBe(3)
        // the band directly under the header types no top of its own
        expect(
            canvasElement.querySelector('td[colspan]')!.querySelector('[class*="run"]'),
        ).toBeNull()
        expect(canvasElement.textContent).toContain('11')
    },
}
