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
        // a band: left + right edges, a top run, and no bottom edge (no interior `|` exists at all —
        // the overlay draws the outline of its own box, so left + right + top is the whole band)
        expect(td.querySelector('[data-edges~="left"]')).toBeTruthy()
        expect(td.querySelector('[data-edges~="right"]')).toBeTruthy()
        expect(td.querySelector('[data-edges~="top"]')).toBeTruthy()
        expect(td.querySelector('[data-edges~="bottom"]')).toBeNull()
        expect(td.querySelector('[data-edges]')!.getAttribute('data-edges')).toBe('top right left')
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
            canvasElement.querySelector('td[colspan]')!.querySelector('[data-edges~="top"]'),
        ).toBeNull()
        expect(canvasElement.textContent).toContain('11')
    },
}
