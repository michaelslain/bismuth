// Visual spec for <ChipToggle> — the selectable pill (export options, search toggles).
// Nothing composes it yet (that lands in a later wave), so this story is the only proof it
// works. Default tone = accent; tone-<x> tints the SELECTED state to a category color.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChipToggle, { type ChipToggleTone } from './ChipToggle'

const meta = {
    title: 'UI/ChipToggle',
    component: ChipToggle,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ChipToggle>

export default meta
type Story = StoryObj<typeof meta>

const TONES: ChipToggleTone[] = ['teal', 'blue', 'violet', 'green', 'gold', 'rose']

export const Unselected: Story = {
    render: () => <ChipToggle>Markdown</ChipToggle>,
}

export const Selected: Story = {
    render: () => <ChipToggle selected>Markdown</ChipToggle>,
}

/** Clicking toggles `selected` via the `onToggle` callback — proves the interaction, not just
 *  the two static states above. */
export const Interactive: Story = {
    render: () => {
        const [selected, setSelected] = createSignal(false)
        return (
            <ChipToggle selected={selected()} onToggle={() => setSelected(s => !s)}>
                Click me
            </ChipToggle>
        )
    },
}

/** Every tone variant, unselected (accent regardless of tone until selected). */
export const AllTonesUnselected: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            {TONES.map(tone => (
                <ChipToggle tone={tone}>{tone}</ChipToggle>
            ))}
        </div>
    ),
}

/** Every tone variant, selected — each should tint to its own category color. */
export const AllTonesSelected: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
            {TONES.map(tone => (
                <ChipToggle tone={tone} selected>
                    {tone}
                </ChipToggle>
            ))}
        </div>
    ),
}

export const LongLabel: Story = {
    render: () => (
        <div style={{ width: '160px' }}>
            <ChipToggle selected tone="violet">
                Include archived + hidden notes in export
            </ChipToggle>
        </div>
    ),
}
