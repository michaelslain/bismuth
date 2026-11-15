// Visual spec for <CardsListEditor> — the Cards mode of the deck editor. Every interactive story
// mounts the component over a signal that applies the same list edits EditCardsModal does, so what
// play() asserts is real state: the order after a keyboard move, the rows after an add / delete.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import CardsListEditor from './CardsListEditor'
import { insertAt, moveItem, removeAt } from './cardsEdit'

const meta = {
    title: 'Bases/CardsListEditor',
    component: CardsListEditor,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardsListEditor>

export default meta
type Story = StoryObj<typeof meta>

type Note = Record<string, unknown>
const CARDS: Note[] = [
    { front: 'Capital of France?', back: 'Paris' },
    { front: 'Capital of Japan?', back: 'Tokyo' },
    { front: 'Capital of Kenya?', back: 'Nairobi' },
]

/** A stateful host: the list edits the modal performs, without the network. */
function Host(props: { initial: Note[] }) {
    const [cards, setCards] = createSignal(props.initial)
    return (
        <div style={{ width: '820px', height: '520px', display: 'flex', 'flex-direction': 'column' }}>
            <CardsListEditor
                cards={cards()}
                frontField="front"
                backField="back"
                busy={false}
                onCommit={(i, field, v) =>
                    setCards(cards().map((n, j) => (j === i ? { ...n, [field]: v } : n)))
                }
                onRemove={i => setCards(removeAt(cards(), i))}
                onReset={() => {}}
                onMove={(from, to) => {
                    setCards(moveItem(cards(), from, to))
                    return true
                }}
                onAdd={async (front, back) => {
                    if (!front && !back) return false
                    setCards(insertAt(cards(), cards().length, { front, back }))
                    return true
                }}
            />
        </div>
    )
}

const fronts = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-testid="cards-row"] [data-cell="front"] textarea')].map(
        el => (el as HTMLTextAreaElement).value,
    )

export const Default: Story = {
    render: () => <Host initial={CARDS} />,
    play: async ({ canvasElement }) => {
        expect(fronts(canvasElement)).toEqual(CARDS.map(c => c.front))
        expect(canvasElement.querySelector('[data-testid="draft-row"]')).not.toBeNull()
    },
}

/** Zero cards: the empty hint, with the draft row still there to add the first one. */
export const Empty: Story = {
    render: () => <Host initial={[]} />,
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('no cards yet')
        expect(canvasElement.querySelectorAll('[data-testid="cards-row"]')).toHaveLength(0)
        expect(canvasElement.querySelector('[data-testid="draft-row"]')).not.toBeNull()
    },
}

/** The `#` handle is a focusable button: Down / Up move the card, and focus follows it. */
export const KeyboardReorder: Story = {
    render: () => <Host initial={CARDS} />,
    play: async ({ canvasElement }) => {
        const handle = (n: number) =>
            canvasElement.querySelector(`[data-card-handle="${n}"]`) as HTMLElement
        handle(0).focus()
        await userEvent.keyboard('{ArrowDown}')
        await waitFor(() =>
            expect(fronts(canvasElement)).toEqual([
                'Capital of Japan?',
                'Capital of France?',
                'Capital of Kenya?',
            ]),
        )
        // Focus followed the moved card to its new slot; Up moves it back.
        await waitFor(() => expect(document.activeElement).toBe(handle(1)))
        await userEvent.keyboard('{ArrowUp}')
        await waitFor(() => expect(fronts(canvasElement)).toEqual(CARDS.map(c => c.front)))
        // Off the top does nothing.
        await userEvent.keyboard('{ArrowUp}')
        expect(fronts(canvasElement)).toEqual(CARDS.map(c => c.front))
    },
}

/** The draft row: Enter in Front moves to Back, Enter in Back adds the card and clears the draft. */
export const AddFromDraft: Story = {
    render: () => <Host initial={CARDS} />,
    play: async ({ canvasElement }) => {
        const draft = canvasElement.querySelector('[data-testid="draft-row"]') as HTMLElement
        const front = draft.querySelector('[data-cell="front"] textarea') as HTMLTextAreaElement
        const back = draft.querySelector('[data-cell="back"] textarea') as HTMLTextAreaElement
        await userEvent.click(front)
        await userEvent.type(front, 'Capital of Italy?')
        await userEvent.keyboard('{Enter}')
        expect(document.activeElement).toBe(back)
        await userEvent.type(back, 'Rome')
        await userEvent.keyboard('{Enter}')
        await waitFor(() =>
            expect(fronts(canvasElement)).toEqual([...CARDS.map(c => c.front), 'Capital of Italy?']),
        )
        expect(front.value).toBe('')
        expect(back.value).toBe('')
    },
}

/** Delete removes exactly that row. */
export const DeleteRow: Story = {
    render: () => <Host initial={CARDS} />,
    play: async ({ canvasElement }) => {
        const rows = canvasElement.querySelectorAll('[data-testid="cards-row"]')
        await userEvent.click(within(rows[1] as HTMLElement).getByLabelText('Delete card'))
        await waitFor(() =>
            expect(fronts(canvasElement)).toEqual(['Capital of France?', 'Capital of Kenya?']),
        )
    },
}

/** A mouse press on card `i`'s `#` handle, carried to (x, y) in steps, the way a person drags:
 *  pointer events, since the app's WKWebView never delivers HTML5 drag-and-drop. */
const handleOf = (root: Element, i: number) =>
    root.querySelector(`[data-card-handle="${i}"]`) as HTMLElement
const rowOf = (root: Element, i: number) =>
    root.querySelector(`[data-card-row="${i}"]`) as HTMLElement
const press = (el: Element) => {
    const r = el.getBoundingClientRect()
    const at = { clientX: r.left + r.width / 2, clientY: r.top + 8 }
    el.dispatchEvent(
        new PointerEvent('pointerdown', { ...at, bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' }),
    )
    return at
}
const moveTo = async (x: number, y: number, from: { clientX: number; clientY: number }, steps = 6) => {
    for (let k = 1; k <= steps; k++) {
        const clientX = from.clientX + ((x - from.clientX) * k) / steps
        const clientY = from.clientY + ((y - from.clientY) * k) / steps
        window.dispatchEvent(
            new PointerEvent('pointermove', { clientX, clientY, bubbles: true, buttons: 1, pointerId: 1, pointerType: 'mouse' }),
        )
        await new Promise(r => requestAnimationFrame(r))
    }
}
const release = (x: number, y: number) =>
    window.dispatchEvent(
        new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' }),
    )

/** Drag card 1 by its `#` onto the lower half of card 3: it lands last, after card 3. Then card 3
 *  dragged onto the upper half of card 1 lands first. Escape mid-drag puts nothing anywhere, and a
 *  plain press with no movement moves nothing. */
export const DragToMove: Story = {
    name: 'Drag to move',
    render: () => <Host initial={CARDS} />,
    play: async ({ canvasElement }) => {
        const start = press(handleOf(canvasElement, 0))
        const last = rowOf(canvasElement, 2).getBoundingClientRect()
        const x = last.left + last.width / 2
        const y = last.bottom - 4
        await moveTo(x, y, start, 8)
        await waitFor(() => expect(rowOf(canvasElement, 2).getAttribute('data-drop')).toBe('after'))
        expect(rowOf(canvasElement, 0).hasAttribute('data-dragging')).toBe(true)
        release(x, y)
        await waitFor(() =>
            expect(fronts(canvasElement)).toEqual(['Capital of Japan?', 'Capital of Kenya?', 'Capital of France?']),
        )
        expect(canvasElement.querySelector('[data-drop]')).toBeNull()
        expect(canvasElement.querySelector('[data-dragging]')).toBeNull()

        // last card to the top
        const again = press(handleOf(canvasElement, 2))
        const first = rowOf(canvasElement, 0).getBoundingClientRect()
        await moveTo(first.left + first.width / 2, first.top + 4, again, 8)
        await waitFor(() => expect(rowOf(canvasElement, 0).getAttribute('data-drop')).toBe('before'))
        release(first.left + first.width / 2, first.top + 4)
        await waitFor(() =>
            expect(fronts(canvasElement)).toEqual(['Capital of France?', 'Capital of Japan?', 'Capital of Kenya?']),
        )

        // Escape mid-drag cancels
        const esc = press(handleOf(canvasElement, 0))
        const r2 = rowOf(canvasElement, 2).getBoundingClientRect()
        await moveTo(r2.left + r2.width / 2, r2.bottom - 4, esc, 6)
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        release(r2.left + r2.width / 2, r2.bottom - 4)
        expect(fronts(canvasElement)).toEqual(CARDS.map(c => c.front))
        expect(canvasElement.querySelector('[data-drop]')).toBeNull()

        // a press without movement is a click, not a drag
        const still = press(handleOf(canvasElement, 1))
        release(still.clientX, still.clientY)
        expect(fronts(canvasElement)).toEqual(CARDS.map(c => c.front))
    },
}

const MANY: Note[] = Array.from({ length: 6 }, (_, i) => ({ front: `Card ${i + 1} front`, back: `Card ${i + 1} back` }))

/** Mid-drag: card 2 lifted (tinted), the accent rule before card 5. */
export const Dragging: Story = {
    render: () => <Host initial={MANY} />,
    play: async ({ canvasElement }) => {
        const start = press(handleOf(canvasElement, 1))
        const r = rowOf(canvasElement, 4).getBoundingClientRect()
        await moveTo(r.left + r.width / 2, r.top + 4, start, 8)
        await waitFor(() => expect(rowOf(canvasElement, 4).getAttribute('data-drop')).toBe('before'))
        expect(rowOf(canvasElement, 1).hasAttribute('data-dragging')).toBe(true)
    },
}
