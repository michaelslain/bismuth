import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CardFrame from './CardFrame'

const meta = {
    title: 'Bases/CardFrame',
    component: CardFrame,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Note: Story = {
    args: { children: <div style={{ padding: '16px' }}>Note card</div> },
}

export const NoteInteractive: Story = {
    args: {
        interactive: true,
        children: <div style={{ padding: '16px' }}>Click to open</div>,
    },
}

export const NoteDraggable: Story = {
    args: {
        draggable: true,
        children: <div style={{ padding: '16px' }}>Drag me (kanban)</div>,
    },
}

export const NoteDropTarget: Story = {
    args: {
        draggable: true,
        dropTarget: true,
        children: <div style={{ padding: '16px' }}>Drop image here</div>,
    },
}

export const Task: Story = {
    args: { kind: 'task', children: <div>Task chip</div> },
}

export const TaskDraggable: Story = {
    args: {
        kind: 'task',
        draggable: true,
        children: <div>Task chip (kanban)</div>,
    },
}

/** `classList` toggles extra classes on the root without replacing the frame's own. */
export const ClassList: Story = {
    args: {
        classList: { extra: true, off: false },
        children: <div style={{ padding: '16px' }}>classList</div>,
    },
    play: async ({ canvasElement }) => {
        const root = canvasElement.firstElementChild as HTMLElement
        expect(root.classList.contains('extra')).toBe(true)
        expect(root.classList.contains('off')).toBe(false)
    },
}

/** A task frame that is also interactive and a drop target: both looks compose on the task box. */
export const TaskInteractiveDropTarget: Story = {
    args: {
        kind: 'task',
        interactive: true,
        dropTarget: true,
        children: <div>Task chip (interactive + drop target)</div>,
    },
}
