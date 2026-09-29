import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { renderCell, renderTitle } from './renderValue'
import Label from '../ui/Label'

const link = { __link: true, path: 'notes/Source Note.md', display: 'a quoted line' }

const row = {
    file: { name: 'Dune', path: 'books/Dune.md' },
    note: {
        status: 'Reading',
        tags: ['sci-fi', 'classic'],
        rating: 4,
        source: link,
        started: new Date('2026-03-14T00:00:00Z'),
        finished: true,
        authors: ['Frank Herbert', 'Brian Herbert'],
        blurb: 'a **desert** planet with `spice`',
        empty: null,
    },
    formula: {},
    index: 0,
} as unknown as Row

const KINDS: [label: string, id: string][] = [
    ['status', 'status'],
    ['tags', 'tags'],
    ['rating', 'rating'],
    ['link', 'source'],
    ['date', 'started'],
    ['boolean', 'finished'],
    ['array', 'authors'],
    ['inline markup', 'blurb'],
    ['empty', 'empty'],
]

/** Every UNDECLARED value kind, one per line, as `renderCell` draws it with no config. */
function Kinds() {
    return (
        <div style={{ display: 'grid', gap: 'var(--sp-4)', padding: 'var(--sp-6)' }}>
            <div data-testid="title">{renderTitle('file.name', row)}</div>
            <For each={KINDS}>
                {([label, id]) => (
                    <div style={{ display: 'flex', gap: 'var(--sp-6)' }}>
                        <Label tone="muted">{label}</Label>
                        <div data-testid={`kind-${id}`}>
                            {renderCell(id, row)}
                        </div>
                    </div>
                )}
            </For>
        </div>
    )
}

const meta = {
    title: 'Bases/RenderValue',
    component: Kinds,
} satisfies Meta<typeof Kinds>

export default meta
type Story = StoryObj<typeof meta>

export const UndeclaredKinds: Story = {}
