// Visual spec for <FlashcardsSummary> — what the stage shows in place of a card: the
// end-of-session recap (deck / cram) and the empty-deck hint (no cards due / no cards at all).
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import FlashcardsSummary from './FlashcardsSummary'

const meta = {
    title: 'Bases/FlashcardsSummary',
    component: FlashcardsSummary,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof FlashcardsSummary>

export default meta
type Story = StoryObj<typeof meta>

/** Deck complete, mostly good: the recap names the count and the `// good on most` tail, and
 *  "review again" restarts — asserted through a real counter. */
export const DeckComplete: Story = {
    args: { variant: 'done', cram: false, reviewed: 3, good: 2, total: 3 },
    render: args => {
        const [restarts, setRestarts] = createSignal(0)
        return (
            <>
                <FlashcardsSummary {...args} onRestart={() => setRestarts(n => n + 1)} />
                <span data-testid="restarts">{restarts()}</span>
            </>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        expect(canvasElement.textContent).toContain('You reviewed 3 cards')
        expect(canvasElement.textContent).toContain('// good on most')
        await userEvent.click(c.getByRole('button', { name: 'review again' }))
        expect(canvasElement.querySelector('[data-testid="restarts"]')!.textContent).toBe('1')
    },
}

/** No `good` grade: the tail is dropped, and one card reads singular. */
export const DeckCompleteNoGood: Story = {
    args: { variant: 'done', cram: false, reviewed: 1, good: 0, total: 1 },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('You reviewed 1 card.')
        expect(canvasElement.textContent).not.toContain('good on most')
    },
}

/** Cram complete: every card mastered, with the number of reviews it took. */
export const CramComplete: Story = {
    args: { variant: 'done', cram: true, reviewed: 7, good: 3, total: 4 },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('Cram complete')
        expect(canvasElement.textContent).toContain('you mastered 4 cards in 7 reviews')
    },
}

/** Nothing due: points at the cram button. */
export const NothingDue: Story = {
    args: { variant: 'empty', cram: false, reviewed: 0, good: 0, total: 0 },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('No cards due')
        expect(canvasElement.textContent).toContain('review everything anyway')
    },
}

/** An empty deck in cram: says what columns a row needs. */
export const EmptyDeck: Story = {
    args: { variant: 'empty', cram: true, reviewed: 0, good: 0, total: 0 },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('No cards in this deck')
        expect(canvasElement.textContent).toContain('front / back columns')
    },
}
