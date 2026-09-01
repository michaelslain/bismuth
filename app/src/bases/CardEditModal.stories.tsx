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
}
