import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import { expect, within } from 'storybook/test'
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import PropertyDisplay from './PropertyDisplay'
import Label from '../ui/Label'

const config = {
    properties: {
        price: { type: { kind: 'number', number: 'currency', unit: 'USD' } },
        genres: { type: { kind: 'multiselect', options: ['sci-fi', 'classic'] } },
        owned: { type: { kind: 'boolean' } },
        notes: { type: { kind: 'markdown' } },
    },
} as unknown as BaseConfig

const row = (note: Record<string, unknown>) =>
    ({
        file: { name: 'Dune', path: 'books/Dune.md' },
        note,
        formula: {},
        index: 0,
    }) as unknown as Row

const KINDS: [label: string, id: string, note: Record<string, unknown>][] = [
    ['number', 'price', { price: 1299.5 }],
    ['multiselect', 'genres', { genres: ['sci-fi', 'classic'] }],
    ['multiselect (empty)', 'genres', { genres: [] }],
    ['boolean yes', 'owned', { owned: true }],
    ['boolean no', 'owned', { owned: false }],
    ['markdown', 'notes', { notes: 'a **desert** planet\n\n- spice\n- worms' }],
    // Undeclared: keeps its heuristic look.
    ['undeclared tags', 'tags', { tags: ['a', 'b'] }],
    ['undeclared boolean', 'read', { read: true }],
]

function Grid(props: { dense?: boolean; inline?: boolean }) {
    return (
        <div
            style={{
                display: 'grid',
                gap: 'var(--sp-4)',
                padding: 'var(--sp-6)',
                'max-width': '420px',
            }}
        >
            <For each={KINDS}>
                {([label, id, note]) => (
                    <div style={{ display: 'flex', gap: 'var(--sp-6)' }}>
                        <Label tone="muted">{label}</Label>
                        <div data-testid={label}>
                            <PropertyDisplay
                                id={id}
                                row={row(note)}
                                config={config}
                                dense={props.dense}
                                inline={props.inline}
                            />
                        </div>
                    </div>
                )}
            </For>
        </div>
    )
}

const meta = {
    title: 'Bases/PropertyDisplay',
    component: Grid,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Grid>

export default meta
type Story = StoryObj<typeof meta>

export const Block: Story = {
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByTestId('boolean yes')).toHaveTextContent('Yes')
        await expect(c.getByTestId('boolean no')).toHaveTextContent('No')
        await expect(c.getByTestId('multiselect')).toHaveTextContent('sci-fi')
        await expect(c.getByTestId('undeclared tags')).toHaveTextContent(
            '#a, #b',
        )
        await expect(c.getByTestId('markdown').querySelector('ul')).not.toBeNull()
    },
}
export const Dense: Story = { args: { dense: true } }
export const Inline: Story = {
    args: { inline: true },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByTestId('markdown').querySelector('ul')).toBeNull()
    },
}
export const DenseInline: Story = { args: { dense: true, inline: true } }
