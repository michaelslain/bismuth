// Visual + behaviour spec for <MonthCell> — one day of the month grid: the day number and whatever
// the register puts in it. A tasks-register cell is a drop target for a dragged task chip; an
// events cell is not. Both hold real state, read back in play(). A lone cell is given every
// position flag, so it types all four edges and reads as one closed cell — inside a grid each
// boundary is typed by exactly one cell (see MonthCell.tsx).
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, within } from 'storybook/test'
import MonthCell from './MonthCell'
import Text from '../../../ui/Text'
import { encodeTaskDrag, TASK_DRAG_MIME } from '../../taskDrag'

const meta = {
    title: 'Calendar/Views/MonthCell',
    component: MonthCell,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof MonthCell>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: any }) => (
    <div style={{ display: 'grid', 'grid-template-columns': '160px', width: '160px' }}>{props.children}</div>
)

export const InMonth: Story = {
    render: () => {
        const [clicks, setClicks] = createSignal(0)
        return (
            <Frame>
                <MonthCell date="2026-01-14" day={14} inMonth today={false} isLastCol isLastRow onOpen={() => setClicks(n => n + 1)}>
                    <Text as="span" size="micro">A chip</Text>
                </MonthCell>
                <output data-testid="clicks">{clicks()}</output>
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await fireEvent.click(c.getByTestId('month-cell'))
        expect(c.getByTestId('clicks').textContent).toBe('1')
        expect(c.getByText('A chip')).toBeInTheDocument()
    },
}

export const SpillDayIsDimmed: Story = {
    render: () => (
        <Frame>
            <MonthCell date="2026-01-31" day={31} inMonth={false} today={false} isLastCol onOpen={() => {}} />
            <MonthCell date="2026-02-01" day={1} inMonth today={false} isLastCol isLastRow onOpen={() => {}} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const dim = getComputedStyle(c.getByText('31')).opacity
        const live = getComputedStyle(c.getByText('1')).opacity
        expect(Number(dim)).toBeLessThan(Number(live))
    },
}

export const TasksCellAcceptsADrop: Story = {
    render: () => {
        const [dropped, setDropped] = createSignal('nothing')
        return (
            <Frame>
                <MonthCell
                    date="2026-01-20"
                    day={20}
                    inMonth
                    today={false}
                    isLastCol
                    isLastRow
                    onOpen={() => {}}
                    onDropTask={(ref, date) => setDropped(`${ref.path}:${ref.line}->${date}`)}
                />
                <output data-testid="dropped">{dropped()}</output>
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const dataTransfer = new DataTransfer()
        dataTransfer.setData(TASK_DRAG_MIME, encodeTaskDrag({ path: 'todo.md', line: 3, field: 'due' }))
        c.getByTestId('month-cell').dispatchEvent(
            new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
        )
        expect(c.getByTestId('dropped').textContent).toBe('todo.md:3->2026-01-20')
    },
}

export const EventsCellIgnoresADrop: Story = {
    render: () => (
        <Frame>
            <MonthCell date="2026-01-20" day={20} inMonth today={false} isLastCol isLastRow onOpen={() => {}} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const cell = within(canvasElement).getByTestId('month-cell')
        const ev = new Event('dragover', { bubbles: true, cancelable: true })
        cell.dispatchEvent(ev)
        expect(ev.defaultPrevented).toBe(false)
    },
}
