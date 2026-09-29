// Visual spec for the leaf value renderers: status, tags (plain + dense), stars and the
// undeclared-value renderValue. renderValue.stories.tsx covers them through renderCell.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import type { Row } from '../../../core/src/bases/types'
import { renderStars, renderStatus, renderTags, renderValue } from './valueRenderers'
import Label from '../ui/Label'

const row = {
    file: { name: 'Dune', path: 'books/Dune.md' },
    note: { finished: true, started: new Date('2026-03-14T00:00:00Z'), authors: ['Frank', 'Brian'] },
    formula: {},
    index: 0,
} as unknown as Row

const LINES: [label: string, content: () => unknown][] = [
    ['status', () => renderStatus('Reading')],
    ['tags', () => renderTags(['sci-fi', 'classic'])],
    ['tags dense', () => renderTags(['sci-fi', 'classic'], true)],
    ['tags empty', () => renderTags([])],
    ['stars', () => renderStars(4)],
    ['boolean', () => renderValue('finished', row)],
    ['date', () => renderValue('started', row)],
    ['array', () => renderValue('authors', row)],
]

function Renderers() {
    return (
        <div style={{ display: 'grid', gap: 'var(--sp-4)', padding: 'var(--sp-6)' }}>
            <For each={LINES}>
                {([label, content]) => (
                    <div style={{ display: 'flex', gap: 'var(--sp-6)' }}>
                        <Label tone="muted">{label}</Label>
                        <div data-testid={`render-${label}`}>{content() as never}</div>
                    </div>
                )}
            </For>
        </div>
    )
}

const meta = {
    title: 'Bases/ValueRenderers',
    component: Renderers,
} satisfies Meta<typeof Renderers>

export default meta
type Story = StoryObj<typeof meta>

export const Leaves: Story = {}
