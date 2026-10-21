// Visual spec for <CodeFence> — a fenced code block inside rendered markdown (a chat message): the
// note's code band with CodeHeader on top. The `<pre>` is built the way marked renders a fence, so
// the story feeds CodeFence exactly what codeFences.ts adopts.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import CodeFence from './CodeFence'
import { ToastHost } from './ToastHost'

const meta = {
    title: 'UI/CodeFence',
    component: CodeFence,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CodeFence>

export default meta
type Story = StoryObj<typeof meta>

const fence = (lang: string, code: string): HTMLPreElement => {
    const pre = document.createElement('pre')
    const el = document.createElement('code')
    if (lang) el.className = `language-${lang}`
    el.textContent = code + '\n'
    pre.append(el)
    return pre
}

/** A `sh` fence: ```sh label left, copy right, the code under it on the same inset. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <CodeFence pre={fence('sh', 'bun run db:migrate\nbun run daemon restart')} />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByTestId('code-lang').textContent).toBe('```sh')
    },
}

/** A bare ``` fence: the label is the bare fence. */
export const NoLanguage: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <CodeFence pre={fence('', 'echo hello')} />
            <ToastHost />
        </div>
    ),
}

/** A line longer than the column: the code scrolls inside the fence, the header stays put. */
export const LongLine: Story = {
    render: () => (
        <div style={{ width: '320px' }}>
            <CodeFence
                pre={fence(
                    'ts',
                    "const veryLongIdentifierName = someFunctionCall(argumentOne, argumentTwo, 'a string')",
                )}
            />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const pre = canvasElement.querySelector('pre')!
        const fenceBox = canvasElement.querySelector('[data-code-fence]')!
        await expect(pre.scrollWidth).toBeGreaterThan(pre.clientWidth)
        await expect(fenceBox.scrollWidth).toBe(fenceBox.clientWidth)
        // sideways only, so a vertical wheel over the code reaches whatever scrolls behind the fence
        await expect(getComputedStyle(pre).overflowY).toBe('hidden')
        await expect(getComputedStyle(pre).overscrollBehaviorY).toBe('auto')
    },
}
