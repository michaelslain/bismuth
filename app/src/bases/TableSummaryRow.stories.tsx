import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TableSummaryRow from './TableSummaryRow'

const meta = {
    title: 'Bases/TableSummaryRow',
    component: TableSummaryRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TableSummaryRow>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: unknown }) => (
    <table style={{ width: '100%', 'border-collapse': 'collapse' }}>
        {props.children as never}
    </table>
)

/** One summary value under the columns that have one; the rest stay empty cells so the rule
 *  still spans the table. */
export const Default: Story = {
    render: () => (
        <Frame>
            <TableSummaryRow
                cols={['title', 'pages', 'rating']}
                summaries={{ 'note.pages': '1,240', 'note.rating': '4.2' }}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const cells = [...canvasElement.querySelectorAll('td')]
        expect(cells.length).toBe(3)
        expect((cells[0].textContent ?? '').trim()).toBe('')
        expect(cells[1].textContent).toContain('1,240')
        expect(cells[2].textContent).toContain('4.2')
    },
}
