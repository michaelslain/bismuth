// Visual spec for <BooleanValue> — the ONE read-only boolean: `[ ]` false, `[x]` true.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import BooleanValue from './BooleanValue'

const meta = {
    title: 'Bases/BooleanValue',
    component: BooleanValue,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof BooleanValue>

export default meta
type Story = StoryObj<typeof meta>

/** Both values side by side. False is a drawn `[ ]`, never blank: a missing glyph reads as "no value". */
export const Both: Story = {
    args: { value: true },
    render: () => (
        <div style={{ display: 'flex', gap: 'var(--sp-6)', 'font-family': 'var(--ui-font-stack)', 'font-size': 'var(--fs-ui)' }}>
            <BooleanValue value={false} />
            <BooleanValue value />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [no, yes] = [...canvasElement.querySelectorAll<HTMLElement>('[role="img"]')]
        expect(no!.getAttribute('aria-label')).toBe('no')
        expect(yes!.getAttribute('aria-label')).toBe('yes')
        expect(yes!.hasAttribute('data-checked')).toBe(true)
        const glyph = (el: HTMLElement) =>
            getComputedStyle(el.querySelector('i')!, '::before').content
        expect(glyph(yes!)).toBe('"x"')
        expect(glyph(no!)).not.toBe('"x"')
        expect(no!.getBoundingClientRect().height).toBeGreaterThan(0)
    },
}
