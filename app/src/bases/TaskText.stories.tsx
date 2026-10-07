// Visual spec for <TaskText> — every inline segment kind, plus a long line that wraps.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import TaskText from './TaskText'

const meta = {
    title: 'Bases/TaskText',
    component: TaskText,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TaskText>

export default meta
type Story = StoryObj<typeof meta>

export const Plain: Story = {
    args: { text: 'ship the parser' },
    play: async ({ canvasElement }) => {
        expect(within(canvasElement).getByText('ship the parser')).toBeTruthy()
    },
}

export const AllSegments: Story = {
    args: {
        text: 'email [[Ann|Ann B]] about [[projects/Plan]] and [docs](https://example.com) #ops/now **must** do *soon*',
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('Ann B').tagName).toBe('A')
        expect(canvas.getByText('Plan').tagName).toBe('A')
        expect(canvas.getByText('#ops/now')).toBeTruthy()
        // An external link is a NoteLink `external` — a real anchor, the same kind as the wikilinks.
        expect(canvas.getByText('docs').tagName).toBe('A')
        expect(getComputedStyle(canvas.getByText('docs')).textDecorationLine).toBe(
            getComputedStyle(canvas.getByText('Plan')).textDecorationLine,
        )
        expect(getComputedStyle(canvas.getByText('must')).fontWeight).not.toBe(
            getComputedStyle(canvas.getByText('email')).fontWeight,
        )
        expect(getComputedStyle(canvas.getByText('soon')).fontStyle).toBe('italic')
    },
}

/** A `javascript:` url parses as a link but must render inert. */
export const UnsafeLinkIsInert: Story = {
    args: { text: 'do [not click](javascript:alert(1) please' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('not click').tagName).toBe('SPAN')
    },
}

export const LongWrapped: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            <TaskText text="review the [[Quarterly Plan]] with **everyone** on the team #planning and then follow up on every open question in *writing* before the end of the week" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        // Wrapped inside its 260px box: taller than one line, and no horizontal overflow.
        const root = canvasElement.firstElementChild as HTMLElement
        const box = root.firstElementChild as HTMLElement
        expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth)
        expect(box.getBoundingClientRect().height).toBeGreaterThan(30)
        expect(within(canvasElement).getByText('Quarterly Plan').tagName).toBe('A')
    },
}

/** Clicking a wikilink dispatches the same `bismuth-open` payload NoteLink sends: the note path. */
export const WikilinkOpens: Story = {
    args: { text: 'see [[Ann]]' },
    play: async ({ canvasElement }) => {
        const seen: unknown[] = []
        const onOpen = (e: Event) => seen.push((e as CustomEvent).detail)
        window.addEventListener('bismuth-open', onOpen)
        try {
            await userEvent.click(within(canvasElement).getByText('Ann'))
        } finally {
            window.removeEventListener('bismuth-open', onOpen)
        }
        expect(seen).toEqual(['Ann.md'])
    },
}
