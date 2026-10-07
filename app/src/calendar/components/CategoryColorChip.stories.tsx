// Visual spec for <CategoryColorChip> — a category's colour dot that opens the theme palette. The
// dot is the resolved swatch (a token name or a `var(--token)`), and a category with no colour yet
// falls back to the accent instead of rendering nothing.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, For } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import CategoryColorChip from './CategoryColorChip'
import { PALETTE_TOKENS } from '../../ui/palette'
import Text from '../../ui/Text'

const meta = {
    title: 'Calendar/CategoryColorChip',
    component: CategoryColorChip,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof CategoryColorChip>

export default meta
type Story = StoryObj<typeof meta>

/** Every palette token as a closed chip — each dot must paint a real, different colour. */
export const AllTokens: Story = {
    args: { color: 'blue', open: false, onToggle: () => {}, onPick: () => {} },
    render: () => (
        <div style={{ display: 'flex', gap: '12px' }}>
            <For each={PALETTE_TOKENS}>
                {token => (
                    <CategoryColorChip
                        color={token}
                        open={false}
                        onToggle={() => {}}
                        onPick={() => {}}
                    />
                )}
            </For>
        </div>
    ),
    play: ({ canvasElement }) => {
        const dots = [...canvasElement.querySelectorAll<HTMLElement>('[data-size="md"]')]
        expect(dots).toHaveLength(PALETTE_TOKENS.length)
        const fills = dots.map(d => getComputedStyle(d).backgroundColor)
        for (const f of fills) expect(f).not.toBe('rgba(0, 0, 0, 0)')
        // seven tokens, seven distinct hues: a dot that ignored its colour would repeat one
        expect(new Set(fills).size).toBe(PALETTE_TOKENS.length)
    },
}

/** No colour stored yet: the dot reads as the accent rather than vanishing. */
export const NoColourFallsBackToAccent: Story = {
    args: { color: '', open: false, onToggle: () => {}, onPick: () => {} },
    play: ({ canvasElement }) => {
        const dot = canvasElement.querySelector<HTMLElement>('[data-size="md"]')!
        const probe = document.createElement('span')
        probe.style.color = 'var(--accent)'
        canvasElement.appendChild(probe)
        const accent = getComputedStyle(probe).color
        probe.remove()
        expect(getComputedStyle(dot).backgroundColor).toBe(accent)
    },
}

/** The palette open under the chip, the stored colour's swatch pressed. */
export const Open: Story = {
    args: { color: 'green', open: true, onToggle: () => {}, onPick: () => {} },
    play: async () => {
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).not.toBeNull(),
        )
        const pressed = document.querySelectorAll(
            '[data-testid="category-palette"] button[aria-pressed="true"]',
        )
        expect(pressed).toHaveLength(1)
        expect(pressed[0]).toHaveAttribute('aria-label', 'green')
    },
}

/** Holds real state: open the palette, pick a swatch, and the dot repaints in the picked colour
 *  while the palette closes. */
export const PickRecolours: Story = {
    args: { color: 'blue', open: false, onToggle: () => {}, onPick: () => {} },
    render: () => {
        const [color, setColor] = createSignal('blue')
        const [open, setOpen] = createSignal(false)
        return (
            <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
                <CategoryColorChip
                    color={color()}
                    open={open()}
                    onToggle={() => setOpen(o => !o)}
                    onPick={token => {
                        setColor(token)
                        setOpen(false)
                    }}
                />
                <Text as="span" data-testid="stored">
                    {color()}
                </Text>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const dot = () => canvasElement.querySelector<HTMLElement>('[data-size="md"]')!
        const before = getComputedStyle(dot()).backgroundColor
        await userEvent.click(canvas.getByLabelText('Choose colour'))
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).not.toBeNull(),
        )
        await userEvent.click(
            document.querySelector('button[aria-label="rose"]') as HTMLElement,
        )
        await waitFor(() =>
            expect(canvas.getByTestId('stored').textContent).toBe('rose'),
        )
        expect(getComputedStyle(dot()).backgroundColor).not.toBe(before)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).toBeNull(),
        )
    },
}
