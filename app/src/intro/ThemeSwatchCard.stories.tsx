// One theme card per state, plus the four side by side. The card paints literal theme colours
// (not var()), so each theme previews itself regardless of the active scope.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { For } from 'solid-js'
import ThemeSwatchCard from './ThemeSwatchCard'
import { THEME_NAMES } from '../themes'

const meta = {
    title: 'Intro/ThemeSwatchCard',
    component: ThemeSwatchCard,
    parameters: { layout: 'centered' },
    args: { name: 'ink', selected: false, onSelect: () => {} },
} satisfies Meta<typeof ThemeSwatchCard>

export default meta
type Story = StoryObj<typeof meta>

export const Ink: Story = {
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')!
        await expect(btn.getAttribute('aria-pressed')).toBe('false')
    },
}

export const PaperSelected: Story = {
    args: { name: 'paper', selected: true },
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')!
        await expect(btn.getAttribute('aria-pressed')).toBe('true')
    },
}

/** All four themes, ink selected — a static row. */
export const AllFour: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: 'var(--sp-5)' }}>
            <For each={THEME_NAMES}>
                {name => (
                    <ThemeSwatchCard {...{ name }} selected={name === 'ink'} onSelect={() => {}} />
                )}
            </For>
        </div>
    ),
}
