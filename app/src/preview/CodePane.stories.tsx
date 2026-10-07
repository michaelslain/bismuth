// app/src/preview/CodePane.stories.tsx
// Visual + behavioural spec for <CodePane> — the read-only monospace body of a code/text preview,
// with find matches marked in place. Mounted in a flex body of the preview's shape.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CodePane from './CodePane'
import { findMatches, segmentText } from './findMatches'

const meta = {
    title: 'Preview/CodePane',
    component: CodePane,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof CodePane>

export default meta
type Story = StoryObj<typeof meta>

const CODE = `export function greet(name: string): string {
    // return a friendly, capitalized greeting
    return \`Hello, \${name}!\`
}

export function farewell(name: string): string {
    return \`Goodbye, \${name}.\`
}
`

function Body(props: { children: import('solid-js').JSX.Element }) {
    return (
        <div style={{ display: 'flex', width: '640px', height: '240px' }}>
            {props.children}
        </div>
    )
}

/** No find running: plain monospace text, no marks. */
export const Plain: Story = {
    args: { code: CODE, activeIndex: 0 },
    render: args => (
        <Body>
            <CodePane {...args} />
        </Body>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-find-match]').length).toBe(0)
        await expect(canvasElement.querySelector('pre')?.textContent).toBe(CODE)
    },
}

/** Three matches for `return`, the second the active one: every match is marked, exactly one is
 *  active, and the active one paints a different (stronger) wash than the rest. */
export const WithMatches: Story = {
    args: {
        code: CODE,
        activeIndex: 1,
        segments: segmentText(CODE, findMatches(CODE, 'return', false)),
    },
    render: args => (
        <Body>
            <CodePane {...args} />
        </Body>
    ),
    play: async ({ canvasElement }) => {
        const marks = [...canvasElement.querySelectorAll<HTMLElement>('[data-find-match]')]
        await expect(marks.length).toBe(3)
        await expect(marks.filter(m => m.hasAttribute('data-active'))).toEqual([marks[1]])
        await expect(getComputedStyle(marks[1]).backgroundColor).not.toBe(
            getComputedStyle(marks[0]).backgroundColor,
        )
    },
}
