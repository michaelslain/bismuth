// Visual spec for <KanbanCard> — the read-only face of one kanban card (title in the prose
// register + one-line properties), rendered standalone (outside KanbanView's board/drag
// machinery) over a sample row. See DESIGN.md's register rule + acceptance 6-9.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { Row } from '../../../core/src/bases/types'
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
const noopRename = async () => undefined

function Card(props: Parameters<typeof KanbanCard>[0]) {
    return (
        <div style={{ width: '240px' }}>
            <KanbanCard {...props} />
        </div>
    )
}

/** Read-only face: title in the prose register (the prose serif), then a one-line-per-property meta
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
            onRename={noopRename}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
}

const LONG_KEY = 'quarterly planning review owner'

/** A long user-named property truncates its KEY (ellipsis, capped at 16ch) instead of widening
 *  the key column until the value is squeezed to a character. The value keeps real width. */
export const LongPropertyName: Story = {
    render: () => (
        <Card
            row={{
                ...SAMPLE_ROWS[1],
                note: {
                    ...SAMPLE_ROWS[1].note,
                    [LONG_KEY]: 'someone with a long name',
                },
            }}
            titleCol="file.name"
            metaCols={['status', LONG_KEY]}
            config={config}
            editable={false}
            onEditingChange={noop}
            onRename={noopRename}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
    play: async ({ canvasElement }) => {
        const key = within(canvasElement).getByText(LONG_KEY)
        const kcs = getComputedStyle(key)
        expect(kcs.textOverflow).toBe('ellipsis')
        expect(key.scrollWidth).toBeGreaterThan(key.clientWidth)
        const value = within(canvasElement).getByText(
            'someone with a long name',
        )
        expect(value.getBoundingClientRect().width).toBeGreaterThan(60)
    },
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
            onRename={noopRename}
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
                onRename={noopRename}
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
            onRename={noopRename}
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
                onRename={noopRename}
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
            onRename={noopRename}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
}

/** A boolean property is the shared `[ ]` / `[x]` glyph (BooleanValue) inside the value cell. */
export const BooleanProperty: Story = {
    render: () => (
        <Card
            row={SAMPLE_ROWS[2]}
            titleCol="file.name"
            metaCols={['done']}
            config={config}
            editable={false}
            onEditingChange={noop}
            onRename={noopRename}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
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
                onRename={noopRename}
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

/** Right-click on the card face opens the same edit modal a tap does (row affordances: no
 *  pencils, right-click opens the editor) — and does not start a drag. */
export const ContextMenuOpensEdit: Story = {
    render: () => (
        <div style={{ width: '240px' }}>
            <KanbanCard
                row={SAMPLE_ROWS[1]}
                titleCol="file.name"
                metaCols={['priority', 'tags']}
                config={config}
                editable
                onEditingChange={noop}
                onRename={noopRename}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const face = canvas.getByRole('button', { name: /^edit /i })

        face.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
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
                onRename={noopRename}
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

/** A declared `number` with a format reads through `formatNumberDisplay` — a currency here. */
export const NumberFormat: Story = {
    render: () => {
        const numberConfig = sampleBaseConfig({
            properties: {
                priority: { type: { kind: 'number', number: 'currency', unit: 'USD' } },
            },
        })
        const row: Row = {
            ...SAMPLE_ROWS[0],
            note: { ...SAMPLE_ROWS[0].note, priority: 1250 },
        }
        return (
            <Card
                row={row}
                titleCol="file.name"
                metaCols={['status', 'priority']}
                config={numberConfig}
                editable={false}
                onEditingChange={noop}
                onRename={noopRename}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('$1,250'))
    },
}

/** A `tags` property declared as a `multiselect` still reads as `#tag`, not bracket chips. */
export const DeclaredMultiselectTags: Story = {
    render: () => {
        const tagConfig = sampleBaseConfig({
            properties: {
                tags: { type: { kind: 'multiselect', options: ['reading', 'urgent', 'ideas'] } },
            },
            declaredProperties: ['status', 'tags'],
        })
        const row: Row = {
            ...SAMPLE_ROWS[0],
            note: { ...SAMPLE_ROWS[0].note, tags: ['reading', 'urgent'] },
        }
        return (
            <Card
                row={row}
                titleCol="file.name"
                metaCols={['tags']}
                config={tagConfig}
                editable={false}
                onEditingChange={noop}
                onRename={noopRename}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(canvasElement.textContent).toContain('#reading, #urgent')
        })
    },
}

/** A declared `multiselect` shows one bracket chip per selected value. */
export const Multiselect: Story = {
    render: () => {
        const msConfig = sampleBaseConfig({
            properties: {
                labels: { type: { kind: 'multiselect', options: ['alpha', 'beta', 'gamma'] } },
            },
            declaredProperties: ['status', 'labels'],
        })
        const row: Row = {
            ...SAMPLE_ROWS[0],
            note: { ...SAMPLE_ROWS[0].note, labels: ['alpha', 'gamma'] },
        }
        return (
            <Card
                row={row}
                titleCol="file.name"
                metaCols={['labels']}
                config={msConfig}
                editable={false}
                onEditingChange={noop}
                onRename={noopRename}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => {
            expect(canvasElement.textContent).toContain('alpha')
            expect(canvasElement.textContent).toContain('gamma')
        })
    },
}

/** A task-line row (`note.line` is a number) is edited by its own task editor, so the card is
 *  a button that opens nothing. */
export const TaskLineRow: Story = {
    render: () => {
        const row: Row = {
            ...SAMPLE_ROWS[0],
            note: { ...SAMPLE_ROWS[0].note, line: 12, status: 'todo' },
        }
        return (
            <Card
                row={row}
                titleCol="file.name"
                metaCols={['status']}
                config={config}
                editable
                onEditingChange={noop}
                onRename={noopRename}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const face = within(canvasElement).getByRole('button', { name: /^edit /i })
        face.focus()
        await userEvent.keyboard('{Enter}')
        await userEvent.click(face)
        expect(within(document.body).queryByRole('dialog')).toBeNull()
    },
}

/** `hasFileIdentity={false}`: the modal renders no title field and no delete button. */
export const NoFileIdentity: Story = {
    render: () => (
        <Card
            row={SAMPLE_ROWS[1]}
            titleCol="file.name"
            metaCols={['priority']}
            config={config}
            editable
            hasFileIdentity={false}
            onEditingChange={noop}
            onRename={noopRename}
            onSetMeta={noop}
            onDelete={noop}
            siblingValues={() => []}
        />
    ),
    play: async ({ canvasElement }) => {
        const face = within(canvasElement).getByRole('button', { name: /^edit /i })
        face.focus()
        await userEvent.keyboard('{Enter}')
        const dialog = await within(document.body).findByRole('dialog', { name: 'edit card' })
        expect(within(dialog).queryByPlaceholderText('Untitled')).toBeNull()
        expect(within(dialog).queryByRole('button', { name: 'delete' })).toBeNull()
    },
}

/** Real state: editing a property in the modal commits it. The story's row lives in a signal,
 *  `onSetMeta` writes the value back into it and records the call, so the play asserts both the
 *  commit and the card face showing the new value. */
export const EditPropertyCommits: Story = {
    render: () => {
        const [row, setRow] = createSignal<Row>(SAMPLE_ROWS[1])
        const [commits, setCommits] = createSignal<string[]>([])
        return (
            <div style={{ width: '240px' }}>
                <KanbanCard
                    row={row()}
                    titleCol="file.name"
                    metaCols={['priority']}
                    config={config}
                    editable
                    onEditingChange={noop}
                    onRename={noopRename}
                    onSetMeta={(id, value) => {
                        setCommits(c => [...c, `${id}=${JSON.stringify(value)}`])
                        setRow(r => ({ ...r, note: { ...r.note, [id]: value } }))
                    }}
                    onDelete={noop}
                    siblingValues={() => []}
                />
                <output data-commits>{commits().join(';')}</output>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const face = within(canvasElement).getByRole('button', { name: /^edit /i })
        face.focus()
        await userEvent.keyboard('{Enter}')
        const dialog = await within(document.body).findByRole('dialog', { name: 'edit card' })
        const input = await within(dialog).findByRole('spinbutton')
        await userEvent.clear(input)
        await userEvent.type(input, '7')
        await userEvent.keyboard('{Tab}')
        await waitFor(() =>
            expect(canvasElement.querySelector('[data-commits]')?.textContent).toBe('priority=7'),
        )
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(within(canvasElement).getByText('7')).toBeTruthy())
    },
}

/** An UNDECLARED `description` (no `markdown` type in the config) still renders as a markdown
 *  block on the card face — list intact, an image embed capped at 180px. */
export const UndeclaredDescription: Story = {
    render: () => {
        const row: Row = {
            ...SAMPLE_ROWS[0],
            note: {
                ...SAMPLE_ROWS[0].note,
                description: '**Ship** the draft.\n\n- gather feedback\n- revise scope\n\n![[x.png]]',
            },
        }
        return (
            <Card
                row={row}
                titleCol="file.name"
                metaCols={['status', 'description']}
                config={sampleBaseConfig()}
                editable={false}
                onEditingChange={noop}
                onRename={noopRename}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('ul')).not.toBeNull())
        const img = canvasElement.querySelector('img.bismuth-embed-img')
        await expect(img).not.toBeNull()
        await expect(getComputedStyle(img as Element).maxHeight).toBe('180px')
    },
}
