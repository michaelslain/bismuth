import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TableGroupRow from './TableGroupRow'

const meta = {
    title: 'Bases/TableGroupRow',
    component: TableGroupRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TableGroupRow>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: unknown }) => (
    <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
        <tbody>{props.children as never}</tbody>
    </table>
)

/** The tinted band carrying `● LABEL // N` — the same header List, Cards and Bullets use. */
export const Default: Story = {
    render: () => (
        <Frame>
            <TableGroupRow label="doing" count={3} colspan={4} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const td = canvasElement.querySelector('td')!
        expect(td.getAttribute('colspan')).toBe('4')
        expect(td.textContent).toContain('doing')
        expect(td.textContent).toContain('3')
        expect(parseFloat(getComputedStyle(td).paddingLeft)).toBeGreaterThan(0)
    },
}

/** Several bands in a row, each group coloured from its own label. */
export const Several: Story = {
    render: () => (
        <Frame>
            <TableGroupRow label="todo" count={4} colspan={3} />
            <TableGroupRow label="doing" count={2} colspan={3} />
            <TableGroupRow label="done" count={11} colspan={3} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelectorAll('tr').length).toBe(3)
        expect(canvasElement.textContent).toContain('11')
    },
}
