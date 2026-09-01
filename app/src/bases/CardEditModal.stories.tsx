// Visual spec for <CardEditModal> — the focused edit modal opened by a tap on a kanban card
// (KanbanCard). Unlike the card face (KanbanCard.stories.tsx), which only shows properties that
// already have a value, this modal lists the title plus EVERY declared property — including
// empty ones — each with a type-aware control: a real Milkdown WYSIWYG surface for `markdown`
// (the SAME rich editor notes use, via MilkdownField), an instant Yes/No Chip for `boolean`, and
// the shared PropertyValueEditor for everything else (text/number/date/select/multiselect).
//
// Reuses the same sample dataset + config as KanbanCard/KanbanView's stories
// (ui/_baseFixtures.ts) so the property vocabulary (status/priority/done/due/tags) matches what
// the real board declares, rather than a story-invented shape.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { CardEditModal } from './CardEditModal'
import { sampleBaseConfig, SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/CardEditModal',
    component: CardEditModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CardEditModal>

export default meta
type Story = StoryObj<typeof meta>

const config = sampleBaseConfig()
const noop = () => {}
const metaCols = ['status', 'priority', 'done', 'due', 'tags']

/** Every declared property control at once: select (status), number (priority), boolean
 *  (done — the Chip toggle), date (due), multiselect (tags). No markdown property in the
 *  curated sample config, so `CardEditModal.tsx`'s Milkdown branch is exercised separately —
 *  see `MilkdownField.stories.tsx` for that surface on its own. */
export const Default: Story = {
    render: () => (
        <CardEditModal
            row={SAMPLE_ROWS[1]}
            titleCol="file.name"
            metaCols={metaCols}
            config={config}
            siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // <Modal> renders via a solid-js/web <Portal> to document.body (see ui/Modal.tsx),
        // OUTSIDE canvasElement — the same reason SymbolGallery.stories.tsx's own tests and
        // GalleryHost.stories.tsx's `GalleryOpen` read `document.body` instead.
        // The title field is seeded from the row (SAMPLE_ROWS[1] = "Ship storybook coverage"),
        // not left blank — the thing `EmptyCard` below exists to contrast against.
        const titleInput = document.querySelector<HTMLInputElement>(
            'input[placeholder="Untitled"]',
        )
        expect(titleInput).not.toBeNull()
        expect(titleInput!.value).toBe('Ship storybook coverage')
        // The `due` property (a declared `date` kind) renders a real `<input type="date">`
        // (PropertyValueEditor.tsx) seeded from the row's value ("2026-08-05") — proves the
        // "every declared property, populated" half of this modal's whole reason to exist.
        const dueInput = document.querySelector<HTMLInputElement>(
            'input[type="date"]',
        )
        expect(dueInput).not.toBeNull()
        expect(dueInput!.value).toBe('2026-08-05')
    },
}

/** A brand-new card: every property still at its default/empty value — the exact gap this
 *  modal exists to close (KanbanCard's read-only face hides an empty property entirely, so a
 *  fresh card looked like it had nothing to edit until this modal listed every declared
 *  column regardless of value). */
export const EmptyCard: Story = {
    render: () => (
        <CardEditModal
            row={{
                file: { ...SAMPLE_ROWS[0].file, name: 'Untitled' },
                note: {},
                formula: {},
            }}
            titleCol="file.name"
            metaCols={metaCols}
            config={config}
            siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            onClose={noop}
        />
    ),
    play: async () => {
        // Same Portal caveat as `Default` above: read document.body, not canvasElement.
        // Falls back to the filename, not the (nonexistent) row title — same field `Default`
        // checks, now proving the OTHER value it can hold.
        const titleInput = document.querySelector<HTMLInputElement>(
            'input[placeholder="Untitled"]',
        )
        expect(titleInput).not.toBeNull()
        expect(titleInput!.value).toBe('Untitled')
        // `note: {}` — the `due` property has no value, so PropertyValueEditor's `toDraft()`
        // returns `''` (its `value == null` branch) rather than a formatted date. This is the
        // state distinction the story exists to demonstrate: a fresh card's declared
        // properties are all present and all EMPTY, not the row's real ("2026-08-05") value
        // `Default` asserts.
        const dueInput = document.querySelector<HTMLInputElement>(
            'input[type="date"]',
        )
        expect(dueInput).not.toBeNull()
        expect(dueInput!.value).toBe('')
    },
}
