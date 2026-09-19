// Visual spec for <CardsModal> — the shared shell (panel sizing + title bar + close button)
// composed by both the deck-wide EditCardsModal and FlashcardsView's single-card edit modal.
// Extracted (design-system conformance, Task 4) because both drew this identically from what
// used to be one shared stylesheet, bases/Flashcards.module.css — the "second importer" case
// the codebase's CSS Modules rule forbids.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import CardsModal from './CardsModal'

const meta = {
    title: 'Bases/CardsModal',
    component: CardsModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CardsModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Default sizing (min(940px, 94vw) x min(840px, 92vh) — EditCardsModal's panel size). */
export const Default: Story = {
    args: {
        title: 'Edit cards',
        onClose: noop,
        children: <div style={{ padding: '20px' }}>Panel body goes here.</div>,
    },
}

/** With the `meta` slot filled — EditCardsModal's deck-name addendum next to the title. */
export const WithMeta: Story = {
    args: {
        title: 'Edit cards',
        onClose: noop,
        meta: (
            <span style={{ color: 'var(--text-muted)' }}>// Geography</span>
        ),
        children: <div style={{ padding: '20px' }}>Panel body goes here.</div>,
    },
}

/** A narrower, fixed-height variant via `class` — FlashcardsView's single-card edit modal
 *  (`.card-edit-one`), which overrides the default width/height. */
export const NarrowVariant: Story = {
    args: {
        title: 'Edit card',
        onClose: noop,
        class: 'card-edit-one-story-demo',
        children: <div style={{ padding: '20px' }}>Front / Back fields go here.</div>,
    },
}
