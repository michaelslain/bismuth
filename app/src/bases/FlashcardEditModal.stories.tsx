// Visual spec for <FlashcardEditModal> — the per-card edit dialog on the flashcards review stage.
// The story holds real state: it opens with a card's prompt and answer, typing edits the draft, and
// `save` hands the DRAFT (not the original) to `onSave`, which the harness prints.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import FlashcardEditModal from './FlashcardEditModal'

const meta = {
    title: 'Bases/FlashcardEditModal',
    component: FlashcardEditModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FlashcardEditModal>

export default meta
type Story = StoryObj<typeof meta>

function Harness() {
    const [saved, setSaved] = createSignal('nothing saved yet')
    return (
        <div>
            <FlashcardEditModal
                front="What is the capital of France?"
                back="Paris"
                onSave={(f, b) => { setSaved(`${f} => ${b}`) }}
                onClose={() => setSaved('closed')}
            />
            <div data-testid="saved">saved: {saved()}</div>
        </div>
    )
}

export const Default: Story = {
    render: () => <Harness />,
    play: async () => {
        const back = await waitFor(() => {
            const el = document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Back"]')
            if (!el) throw new Error('modal not mounted yet')
            return el
        })
        await userEvent.clear(back)
        await userEvent.type(back, 'Paris, on the Seine')
        const save = [...document.querySelectorAll('button')].find(
            b => b.textContent?.trim() === 'save',
        )
        if (!save) throw new Error('no save button')
        await userEvent.click(save)
        await waitFor(() =>
            expect(document.body.textContent).toContain(
                'saved: What is the capital of France? => Paris, on the Seine',
            ),
        )
    },
}
