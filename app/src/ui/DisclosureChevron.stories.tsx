// Visual spec for <DisclosureChevron> — the one disclosure glyph: bare, never bracketed, rotating
// a quarter turn when open. With `onToggle` it is a button; without, a decorative glyph.
//
// Props: open (required), onToggle, label, tabindex, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { createSignal } from 'solid-js'
import DisclosureChevron from './DisclosureChevron'

const meta = {
    title: 'UI/DisclosureChevron',
    component: DisclosureChevron,
    parameters: { layout: 'padded' },
    args: { open: false },
} satisfies Meta<typeof DisclosureChevron>

export default meta
type Story = StoryObj<typeof meta>

/** Decorative: no button, hidden from assistive tech; the header around it owns the click. */
export const Decorative: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '16px' }}>
            <DisclosureChevron open={false} />
            <DisclosureChevron open />
        </div>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('button')).toBeNull()
        const glyphs = canvasElement.querySelectorAll('[data-disclosure-glyph]')
        expect(glyphs.length).toBe(2)
        expect(getComputedStyle(glyphs[0]).transform).toBe('none')
        expect(getComputedStyle(glyphs[1]).transform).not.toBe('none')
    },
}

/** Button form: `aria-expanded` follows the click; the glyph stays bare in both states. */
export const Button: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        return (
            <DisclosureChevron
                open={open()}
                onToggle={() => setOpen(o => !o)}
                label="expand details"
            />
        )
    },
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button') as HTMLElement
        expect(btn.getAttribute('aria-label')).toBe('expand details')
        expect(btn.getAttribute('aria-expanded')).toBe('false')
        await userEvent.click(btn)
        expect(btn.getAttribute('aria-expanded')).toBe('true')
        expect(btn.textContent).not.toContain('[')
    },
}
