// Visual spec for <CodeBlock> — a `<pre>` reset for monospace block text (no margin, the app's
// mono token, wrapping). Everything else — border, padding, background, max-height — comes
// from the caller's `class`. `play` asserts the rendered tag and that the caller class lands on
// the root.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CodeBlock from './CodeBlock'

const meta = {
    title: 'UI/CodeBlock',
    component: CodeBlock,
    parameters: { layout: 'centered' },
    args: {
        children: 'const x = 1\nconsole.log(x)',
    },
} satisfies Meta<typeof CodeBlock>

export default meta
type Story = StoryObj<typeof meta>

/** Bare — no caller class, just the reset. */
export const Playground: Story = {
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')
        expect(pre).not.toBeNull()
        expect(pre!.tagName).toBe('PRE')
    },
}

/** With a caller class — proves the class merges onto the root. */
export const WithCallerClass: Story = {
    args: { class: 'caller-demo-class' },
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')
        expect(pre).not.toBeNull()
        expect(pre!.classList.contains('caller-demo-class')).toBe(true)
    },
}
