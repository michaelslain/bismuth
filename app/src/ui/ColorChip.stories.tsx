// Visual spec for <ColorChip> — a colour swatch chip that opens a palette popover of the six
// theme swatches. Extracted from CategoryPanel's private ColorChip/Palette pair (see that file
// and ColorChip.tsx's header comment) so both CategoryPanel and TaskCalendarSettings compose the
// same component instead of two copies that could drift.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ColorChip from './ColorChip'

const meta = {
    title: 'UI/ColorChip',
    component: ColorChip,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ColorChip>

export default meta
type Story = StoryObj<typeof meta>

/** Resting state — the popover closed. */
export const Closed: Story = {
    args: {
        color: 'rose',
        open: false,
        onToggle: () => {},
        onPick: () => {},
    },
}

/** The popover open, downward (the default) — six token swatches, the stored colour's swatch
 *  highlighted. */
export const Open: Story = {
    args: {
        color: 'jade',
        open: true,
        onToggle: () => {},
        onPick: () => {},
    },
    play: async () => {
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).not.toBeNull(),
        )
    },
}

/** `up` — the popover opens above the chip instead of below, for a chip near the bottom of its
 *  container (CategoryPanel's "new category" row). Rendered near the bottom of a tall box so the
 *  upward direction is visible without clipping. */
export const Up: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div
                style={{
                    height: '160px',
                    display: 'flex',
                    'align-items': 'flex-end',
                }}
            >
                <ColorChip
                    color="gold"
                    open={open()}
                    up
                    onToggle={() => setOpen(v => !v)}
                    onPick={() => {}}
                />
            </div>
        )
    },
    play: async () => {
        const wrapper = document.querySelector(
            '[data-testid="category-chip"]',
        )
        const popover = document.querySelector(
            '[data-testid="category-palette"]',
        )
        if (!(wrapper instanceof HTMLElement))
            throw new Error('chip wrapper not found')
        if (!(popover instanceof HTMLElement))
            throw new Error('popover did not open')
        // `up` opens the popover ABOVE the chip rather than below it — its bottom edge sits
        // above the chip's top edge, not the other way around.
        expect(popover.getBoundingClientRect().bottom).toBeLessThan(
            wrapper.getBoundingClientRect().top,
        )
    },
}

/** Clicking the chip toggles the popover, and picking a swatch reports the token then closes
 *  it — the caller-owned open/close + onPick round trip. */
export const Interactive: Story = {
    render: () => {
        const [color, setColor] = createSignal('accent')
        const [open, setOpen] = createSignal(false)
        return (
            <ColorChip
                color={color()}
                open={open()}
                onToggle={() => setOpen(v => !v)}
                onPick={tok => {
                    setColor(tok)
                    setOpen(false)
                }}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const chip = canvas.getByLabelText('Choose colour')
        await userEvent.click(chip)
        const violet = canvas.getByLabelText('violet')
        await userEvent.click(violet)
        await waitFor(() =>
            expect(
                document.querySelector('[data-testid="category-palette"]'),
            ).toBeNull(),
        )
    },
}
