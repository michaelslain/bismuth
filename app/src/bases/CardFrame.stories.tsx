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

/** The frame composes ui/Card but carries none of its padding: a cover runs edge to edge. It clips
 *  its children by default (the cover's glyph field must not spill). */
export const ClipsByDefault: Story = {
    args: { children: <div style={{ padding: '16px' }}>Clipped</div> },
    play: async ({ canvasElement }) => {
        const root = canvasElement.firstElementChild as HTMLElement
        const cs = getComputedStyle(root)
        expect(cs.overflow).toBe('hidden')
        expect(cs.paddingTop).toBe('0px')
        expect(cs.paddingLeft).toBe('0px')
    },
}

/** `overflow="visible"` is what lets a body card's CodeMirror completion popup leave the card. The
 *  popup stand-in hangs 40px below the frame and must be visible there. */
export const OverflowVisible: Story = {
    args: {
        overflow: 'visible',
        children: (
            <div style={{ padding: '16px', position: 'relative' }}>
                Body card
                <div
                    data-testid="popup"
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: '0',
                        'margin-top': '24px',
                        padding: '8px',
                        background: 'var(--surface-3)',
                        border: 'var(--rule)',
                    }}
                >
                    popup past the card edge
                </div>
            </div>
        ),
    },
    play: async ({ canvasElement }) => {
        const root = canvasElement.firstElementChild as HTMLElement
        expect(getComputedStyle(root).overflow).toBe('visible')
        const popup = canvasElement.querySelector('[data-testid="popup"]') as HTMLElement
        expect(popup.getBoundingClientRect().bottom).toBeGreaterThan(
            root.getBoundingClientRect().bottom,
        )
    },
}
