// Visual spec for <ValueChip> — the non-interactive `[value]` chip that displays a multiselect
// value; identical look to a selected ChipToggle.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChipToggle from './ChipToggle'
import ValueChip from './ValueChip'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/ValueChip',
    component: ValueChip,
    parameters: { layout: 'centered' },
    args: { children: 'research' },
} satisfies Meta<typeof ValueChip>

export default meta
type Story = StoryObj<typeof meta>

export const Plain: Story = {
    // Catches: the bracket glyphs missing (the chip reading as bare text).
    play: async ({ canvasElement }) => {
        const chip = within(canvasElement).getByText('research')
        expect(getComputedStyle(chip, '::before').content.startsWith('"["')).toBe(true)
        expect(getComputedStyle(chip, '::after').content.startsWith('"]"')).toBe(true)
    },
}

export const Coloured: Story = { args: { color: 'var(--rose)' } }

/** Beside a selected ChipToggle: the two read as the same chip. */
export const NextToChipToggle: Story = {
    render: () => (
        <Row label="value chip // selected chip toggle" gap="10px">
            <ValueChip>research</ValueChip>
            <ChipToggle selected>research</ChipToggle>
        </Row>
    ),
}
