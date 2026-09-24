// Visual spec for <KanbanCard> — the read-only face of one kanban card (title + meta chips),
// rendered standalone (outside KanbanView's board/drag machinery) over a sample row.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { KanbanCard } from './KanbanCard'
import { sampleBaseConfig, SAMPLE_ROWS } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/KanbanCard',
    component: KanbanCard,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof KanbanCard>

export default meta
type Story = StoryObj<typeof meta>

const config = sampleBaseConfig()
const noop = () => {}

/** Read-only face: title (file.name) + priority/tags meta chips, each with a label caption. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '240px' }}>
            <KanbanCard
                row={SAMPLE_ROWS[1]}
                titleCol="file.name"
                metaCols={['priority', 'tags']}
                config={config}
                editable={false}
                onEditingChange={noop}
                onRename={noop}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        </div>
    ),
}

/** `editable` + `hideLabels` — the card becomes tappable (cursor affordance) and every meta
 *  chip drops its uppercase label caption, showing values only (#105). */
export const EditableNoLabels: Story = {
    render: () => (
        <div style={{ width: '240px' }}>
            <KanbanCard
                row={SAMPLE_ROWS[4]}
                titleCol="file.name"
                metaCols={['priority', 'tags', 'done']}
                config={config}
                editable
                hideLabels
                onEditingChange={noop}
                onRename={noop}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={id => SAMPLE_ROWS.map(r => r.note[id])}
            />
        </div>
    ),
}

/** Keyboard path for the whole-card open (#compass finding 2): `Enter` and `Space` on the
 *  focused card face open CardEditModal, same as a pointer tap on the bare body. */
export const KeyboardOpensEdit: Story = {
    render: () => (
        <div style={{ width: '240px' }}>
            <KanbanCard
                row={SAMPLE_ROWS[1]}
                titleCol="file.name"
                metaCols={['priority', 'tags']}
                config={config}
                editable
                onEditingChange={noop}
                onRename={noop}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const face = canvas.getByRole('button', { name: /^edit /i })

        face.focus()
        await userEvent.keyboard('{Enter}')
        await within(document.body).findByRole('dialog', { name: 'edit card' })
        await userEvent.keyboard('{Escape}')
        await waitFor(() =>
            expect(within(document.body).queryByRole('dialog')).toBeNull(),
        )

        face.focus()
        await userEvent.keyboard(' ')
        await within(document.body).findByRole('dialog', { name: 'edit card' })
    },
}

/** Non-editable face carries neither `role` nor `tabIndex` — there is nothing to activate. */
export const NotEditableHasNoButtonRole: Story = {
    render: () => (
        <div style={{ width: '240px' }}>
            <KanbanCard
                row={SAMPLE_ROWS[1]}
                titleCol="file.name"
                metaCols={['priority', 'tags']}
                config={config}
                editable={false}
                onEditingChange={noop}
                onRename={noop}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.queryByRole('button', { name: /^edit /i })).toBeNull()
        const face = canvasElement.querySelector('[class*="kbCardFace"]')
        expect(face?.hasAttribute('tabindex')).toBe(false)
    },
}
