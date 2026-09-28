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
