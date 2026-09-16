// Visual spec for <PlainButton> — an unstyled button reset. Always renders `type="button"`;
// every visual property comes from the caller's `class`. `play` asserts the rendered tag +
// attribute and that the caller class lands on the root, since the component itself paints
// nothing to look at.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import PlainButton from './PlainButton'

const meta = {
    title: 'UI/PlainButton',
    component: PlainButton,
    parameters: { layout: 'centered' },
    args: { children: 'Plain' },
} satisfies Meta<typeof PlainButton>

export default meta
type Story = StoryObj<typeof meta>

/** Bare — no caller class, just the reset. */
export const Playground: Story = {
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')
        expect(btn).not.toBeNull()
        expect(btn!.getAttribute('type')).toBe('button')
    },
}

/** With a caller class + disabled — proves the class merges onto the root and disabled passes
 *  through untouched. */
export const WithCallerClass: Story = {
    args: {
        class: 'caller-demo-class',
        disabled: true,
        children: 'Disabled',
    },
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button')
        expect(btn).not.toBeNull()
        expect(btn!.tagName).toBe('BUTTON')
        expect(btn!.getAttribute('type')).toBe('button')
        expect(btn!.classList.contains('caller-demo-class')).toBe(true)
        expect(btn!.disabled).toBe(true)
    },
}
