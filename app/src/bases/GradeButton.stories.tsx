// Visual spec for <GradeButton> — a flashcard grade with its keybinding caps underneath.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import GradeButton from './GradeButton'

const meta = {
    title: 'Bases/GradeButton',
    component: GradeButton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof GradeButton>

export default meta
type Story = StoryObj<typeof meta>

/** The default bindings: a single cap under each word. */
export const Default: Story = {
    args: { label: 'good', combo: '2', title: 'good (2)', onClick: () => {} },
}

/** A rebound chord: the caps widen, and stay centred under the label. */
export const Chord: Story = {
    args: {
        label: 'easy',
        combo: 'Mod+Shift+3',
        title: 'easy (Mod+Shift+3)',
        onClick: () => {},
    },
}

/** No binding: the label alone, no empty cap row. */
export const Unbound: Story = {
    args: { label: 'hard', title: 'hard', onClick: () => {} },
}
