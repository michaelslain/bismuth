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

/** `typed` beside the default: the surface card draws a fill and a CSS border; the typed card is a
 *  `+ - | ` box on the pane ground (AsciiCellEdges, `--table-edge` ink) with no fill or border of its
 *  own, text 2ch in from the `|`. The edges are a child overlay, so the frame must not clip. */
export const TypedBesideDefault: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '4ch', 'align-items': 'flex-start', padding: '2ch' }}>
            <div style={{ width: '24ch' }}>
                <CardFrame kind="task">
                    <div>default task card</div>
                </CardFrame>
            </div>
            <div style={{ width: '24ch' }}>
                <CardFrame typed kind="task">
                    <div>typed task card</div>
                </CardFrame>
            </div>
            <div style={{ width: '24ch' }}>
                <CardFrame typed draggable>
                    <div>typed note card (hover me)</div>
                </CardFrame>
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [plain, typedTask, typedNote] = [
            ...canvasElement.querySelectorAll<HTMLElement>('[style*="24ch"] > *'),
        ]
        expect(getComputedStyle(plain).borderTopStyle).not.toBe('none')
        for (const el of [typedTask, typedNote]) {
            const cs = getComputedStyle(el)
            expect(cs.borderTopStyle).toBe('none')
            expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)')
            expect(cs.overflow).toBe('visible')
            // the four typed edges are one overlay child
            expect(el.querySelector('[data-edges="top right bottom left"]')).not.toBeNull()
        }
        expect(plain.querySelector('[data-edges]')).toBeNull()
    },
}
