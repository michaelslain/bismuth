// Visual spec for <KanbanCard> — the read-only face of one kanban card (title in the prose
// register + one-line properties), rendered standalone (outside KanbanView's board/drag
// machinery) over a sample row. See DESIGN.md's register rule + acceptance 6-9.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { Row } from '../../../core/src/bases/types'
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

function Card(props: Parameters<typeof KanbanCard>[0]) {
    return (
        <div style={{ width: '240px' }}>
            <KanbanCard {...props} />
        </div>
    )
}

/** Read-only face: title in the prose register (Lora), then a one-line-per-property meta
 *  grid — a date, a select and a number, mixed kinds, every value starting at the same x. */
export const Default: Story = {
    render: () => (
        <Card
            row={SAMPLE_ROWS[1]}
            titleCol="file.name"
            metaCols={['due', 'status', 'priority']}
            config={config}
            editable={false}
            onEditingChange={noop}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
}

/** No `order:` properties left after the title — the card face is title-only, no meta grid
 *  at all. */
export const NoProperties: Story = {
    render: () => (
        <Card
            row={SAMPLE_ROWS[0]}
            titleCol="file.name"
            metaCols={[]}
            config={config}
            editable={false}
            onEditingChange={noop}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
}

/** A long title wraps (`overflow-wrap: anywhere`) inside the card's fixed width instead of
 *  overflowing it, still rendered in the prose register. */
export const LongTitle: Story = {
    render: () => {
        const row: Row = {
            ...SAMPLE_ROWS[3],
            file: {
                ...SAMPLE_ROWS[3].file,
                name: 'Investigate the intermittent websocket disconnect affecting the mobile app during background sync',
            },
        }
        return (
            <Card
                row={row}
                titleCol="file.name"
                metaCols={['status']}
                config={config}
                editable={false}
                onEditingChange={noop}
                onRename={noop}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        )
    },
}

/** `editable` + `hideLabels` (#105) — the card is tappable and the meta grid collapses to a
 *  single column of values with no key. */
export const HideLabels: Story = {
    render: () => (
        <Card
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
    ),
}

/** A declared `markdown` property body (acceptance 9) — prose register at `--fs-body`, no key,
 *  spanning the full card width. */
export const MarkdownDescription: Story = {
    render: () => {
        const markdownConfig = sampleBaseConfig({
            properties: { description: { type: { kind: 'markdown' } } },
            declaredProperties: ['status', 'priority', 'done', 'due', 'tags', 'description'],
        })
        const row: Row = {
            ...SAMPLE_ROWS[0],
            note: {
                ...SAMPLE_ROWS[0].note,
                description:
                    '**Ship** the roadmap draft to the team by Friday.\n\n- gather feedback\n- revise scope',
            },
        }
        return (
            <Card
                row={row}
                titleCol="file.name"
                metaCols={['status', 'description']}
                config={markdownConfig}
                editable={false}
                onEditingChange={noop}
                onRename={noop}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        )
    },
}

/** Tags (acceptance 8) — the app's existing `[tag]` chip rendering, on their own line with no
 *  key. */
export const Tags: Story = {
    render: () => (
        <Card
            row={SAMPLE_ROWS[3]}
            titleCol="file.name"
            metaCols={['tags']}
            config={config}
            editable={false}
            onEditingChange={noop}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
}

/** A boolean property keeps its ChipToggle display inside the value cell. */
export const BooleanProperty: Story = {
    render: () => (
        <Card
            row={SAMPLE_ROWS[2]}
            titleCol="file.name"
            metaCols={['done']}
            config={config}
            editable={false}
            onEditingChange={noop}
            onRename={noop}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
}
