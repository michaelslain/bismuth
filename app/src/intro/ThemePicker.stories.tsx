import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import ThemePicker from './ThemePicker'
import type { ThemeName } from '../themes'

const meta = {
    title: 'Intro/ThemePicker',
    component: ThemePicker,
    parameters: { layout: 'centered' },
    args: { value: 'ink', onChange: () => {} },
} satisfies Meta<typeof ThemePicker>

export default meta
type Story = StoryObj<typeof meta>

/** Ink selected, as the intro opens. */
export const Default: Story = {
    play: async ({ canvasElement }) => {
        const group = canvasElement.querySelector('[role="group"]')!
        await expect(group.getAttribute('aria-label')).toBe('Theme')
        const pressed = group.querySelectorAll('[aria-pressed="true"]')
        await expect(pressed.length).toBe(1)
    },
}

/** Holds its own selection in a local signal. */
export const Interactive: Story = {
    render: () => {
        const [value, setValue] = createSignal<ThemeName>('ink')
        return <ThemePicker value={value()} onChange={setValue} />
    },
}

/** A narrow window: the four cards shrink inside the art box, never overflow it — every colour
 *  chip stays inside its own card's well (not across a neighbour) and each name stays on one line. */
export const Narrow: Story = {
    play: async ({ canvasElement }) => {
        const cards = [...canvasElement.querySelectorAll('button')]
        await expect(cards.length).toBe(4)
        for (const card of cards) {
            const well = card.firstElementChild!.getBoundingClientRect()
            const chips = card.querySelectorAll('[class*="chip"]')
            await expect(chips.length).toBeGreaterThan(0)
            for (const chip of chips) {
                const r = chip.getBoundingClientRect()
                await expect(r.left).toBeGreaterThanOrEqual(well.left - 0.5)
                await expect(r.right).toBeLessThanOrEqual(well.right + 0.5)
            }
            const name = card.lastElementChild as HTMLElement
            await expect(name.getBoundingClientRect().height).toBeLessThan(
                1.5 * parseFloat(getComputedStyle(name).lineHeight),
            )
        }
    },
    decorators: [
        Story => (
            <div style={{ width: 'calc(90 * var(--cell-w))' }}>
                <Story />
            </div>
        ),
    ],
}
