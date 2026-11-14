// Visual spec for <TaskMark>: the four task status marks as typed brackets, in the inks the task
// checkbox and the editor use (`[x]` `[/]` accent, `[ ]` muted, `[-]` faint).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import TaskMark from './TaskMark'

const meta = {
    title: 'UI/TaskMark',
    component: TaskMark,
    parameters: { layout: 'centered' },
    args: { char: ' ' },
} satisfies Meta<typeof TaskMark>

export default meta
type Story = StoryObj<typeof meta>

export const Todo: Story = {}
export const InProgress: Story = { args: { char: '/' } }
export const Done: Story = { args: { char: 'x' } }
export const Cancelled: Story = { args: { char: '-' } }

/** All four side by side; the inks differ per state (accent, accent, muted, faint). */
export const All: Story = {
    render: () => (
        <div
            style={{
                display: 'flex',
                gap: '16px',
                'align-items': 'center',
                'font-family': 'var(--ui-font-stack)',
                'font-size': 'var(--fs-ui)',
            }}
        >
            <TaskMark char=" " />
            <TaskMark char="/" />
            <TaskMark char="x" />
            <TaskMark char="-" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const marks = [...canvasElement.querySelectorAll<HTMLElement>('[aria-hidden="true"]')]
        expect(marks).toHaveLength(4)
        const ink = marks.map(m => getComputedStyle(m).color)
        expect(ink[1]).toBe(ink[2])
        expect(new Set(ink).size).toBe(3)
    },
}
