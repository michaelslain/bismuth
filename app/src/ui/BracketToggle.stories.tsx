// Visual spec for <BracketToggle> — the presentational `[ ]` / `[x]` checkbox glyph (was
// `.evm-modal .evm-toggle`). Purely visual: the row or label around it owns the click and ARIA —
// ToggleRow composes it for settings rows, and EventModal's own all-day toggle uses it directly.
//
// Props: checked, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import BracketToggle from './BracketToggle'

const meta = {
    title: 'UI/BracketToggle',
    component: BracketToggle,
    parameters: { layout: 'centered' },
    args: { checked: false },
} satisfies Meta<typeof BracketToggle>

export default meta
type Story = StoryObj<typeof meta>

/** Off — `[ ]`. */
export const Off: Story = {}

/** On — `[x]`. */
export const On: Story = { args: { checked: true } }

/** Both states side by side. `play` reads the pseudo-element content and computed color rather
 *  than the DOM (the glyph is a CSS `::before`, invisible to `textContent`). A regression that
 *  stops flipping the `x` glyph, or stops recoloring the on-state to `--accent`, fails this
 *  without changing a single DOM node. */
export const Both: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
            <BracketToggle checked={false} />
            <BracketToggle checked={true} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const toggles = [
            ...canvasElement.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
        ]
        expect(toggles.length).toBe(2)
        const [off, on] = toggles
        const offGlyph = getComputedStyle(
            off!.querySelector('i')!,
            '::before',
        ).content
        const onGlyph = getComputedStyle(
            on!.querySelector('i')!,
            '::before',
        ).content
        expect(onGlyph).toBe('"x"')
        expect(onGlyph).not.toBe(offGlyph)
        expect(getComputedStyle(on!).color).not.toBe(
            getComputedStyle(off!).color,
        )
    },
}
