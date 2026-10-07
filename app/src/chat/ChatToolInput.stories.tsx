// Visual spec for <ChatToolInput> — the one tool-input block both the tool row and the permission
// card render. Proves the two tones differ only in ink (same box, same size, same rule), the cap
// scrolls rather than grows, and the caption is lowercase.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatToolInput from './ChatToolInput'

const meta = {
    title: 'Chat/ChatToolInput',
    component: ChatToolInput,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatToolInput>

export default meta
type Story = StoryObj<typeof meta>

/** The computed colour a token resolves to, read off a throwaway probe in the canvas. */
const inkOf = (host: HTMLElement, token: string) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${token})`
    host.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
}

const json = JSON.stringify(
    { file_path: 'notes/roadmap.md', offset: 0, limit: 200 },
    null,
    2,
)

/** The input a user is deciding on — full ink, a lowercase caption, `--code-font-size` mono. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatToolInput label="input" text={json} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const label = canvas.getByText('input')
        await expect(getComputedStyle(label).textTransform).toBe('none')
        const body = canvasElement.querySelector('pre') as HTMLElement
        // The mechanism size: a probe set to --code-font-size resolves to the same px.
        const probe = document.createElement('span')
        probe.style.fontSize = 'var(--code-font-size)'
        canvasElement.appendChild(probe)
        await expect(getComputedStyle(body).fontSize).toBe(
            getComputedStyle(probe).fontSize,
        )
        probe.remove()
    },
}

/** A summary that restates what the card's head already says — muted ink, same box. */
export const Muted: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatToolInput tone="muted" maxHeight={160} text="Write notes/todo.md" />
            <ChatToolInput text="Write notes/todo.md" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [muted, normal] = Array.from(canvasElement.querySelectorAll('pre')) as HTMLElement[]
        // the muted block reads --text-muted, the one beside it keeps the default ink
        await expect(getComputedStyle(muted).color).toBe(inkOf(canvasElement, '--text-muted'))
        await expect(getComputedStyle(normal).color).toBe(inkOf(canvasElement, '--fg'))
        await expect(getComputedStyle(muted).color).not.toBe(getComputedStyle(normal).color)
        // same box, same size, same rule: only the ink differs
        await expect(getComputedStyle(muted).fontSize).toBe(getComputedStyle(normal).fontSize)
        await expect(getComputedStyle(muted).borderTopWidth).toBe(
            getComputedStyle(normal).borderTopWidth,
        )
        await expect(getComputedStyle(muted).paddingTop).toBe(getComputedStyle(normal).paddingTop)
    },
}

/** A failed call's output reads in the danger ink. */
export const ErrorOutput: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatToolInput label="error" error text="error: 3 tests failed" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const body = canvasElement.querySelector('pre') as HTMLElement
        await expect(getComputedStyle(body).color).toBe(inkOf(canvasElement, '--danger'))
        await expect(getComputedStyle(body).color).not.toBe(inkOf(canvasElement, '--fg'))
    },
}

/** Past the cap it scrolls — the block never grows past `maxHeight`. */
export const Capped: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatToolInput
                label="result"
                maxHeight={96}
                text={Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n')}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const body = canvasElement.querySelector('pre') as HTMLElement
        await expect(body.getBoundingClientRect().height).toBeLessThanOrEqual(96)
        await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
    },
}
