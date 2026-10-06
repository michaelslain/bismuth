// Visual spec for <IntroCopy> — the first-run intro's headline + paragraph block, in the prose
// face: a 40px regular-weight headline over a lead-size, 34em-measure paragraph.
//
// Props: title, body, type (type the text in on mount; default on — every story but `Typing` turns it
// off so its screenshot is one stable frame), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import IntroCopy from './IntroCopy'

const meta = {
    title: 'Intro/IntroCopy',
    component: IntroCopy,
    parameters: { layout: 'centered' },
    argTypes: {
        title: { control: 'text' },
        body: { control: 'text' },
        type: { control: 'boolean' },
    },
} satisfies Meta<typeof IntroCopy>

export default meta
type Story = StoryObj<typeof meta>

/** The welcome slide's copy — the everyday state, no graph behind it. */
export const Default: Story = {
    args: {
        title: 'Notes that think',
        body: 'Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.',
        type: false,
    },
}

/** The agents slide's long body — the longest paragraph in the flow, to check the 34em measure. */
export const LongBody: Story = {
    args: {
        title: 'Bring your own agent',
        body: 'Chat runs on whichever coding agent you already use — Claude Code, Codex, Gemini, opencode, Cline, Goose. Bismuth speaks MCP, so any of them can search the docs and write your bases, queries and notes.',
        type: false,
    },
}

const TYPING_TITLE = 'Notes that think'
const TYPING_BODY =
    'Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.'

/** The default: the text types in on mount, headline first, at an irregular per-letter rhythm,
 *  behind a cursor that rests blinking at the end of the body. The full text is in the DOM from the
 *  first frame (the untyped remainder is only `opacity: 0`, the cursor a zero-width aria-hidden
 *  box), so nothing reflows. The screenshot of this story is the finished frame. */
export const Typing: Story = {
    args: { title: TYPING_TITLE, body: TYPING_BODY },
    play: async ({ canvasElement }) => {
        const heading = canvasElement.querySelector('h1')!
        // The words a reader gets: everything but the aria-hidden cursor.
        const words = (el: Element) => {
            const copy = el.cloneNode(true) as Element
            copy.querySelectorAll('[data-cursor]').forEach(c => c.remove())
            return copy.textContent
        }
        // Whole from the first frame, whatever has been typed so far.
        await expect(words(heading)).toBe(TYPING_TITLE)
        const untyped = () =>
            [...canvasElement.querySelectorAll('[data-untyped]')].filter(
                el => (el.textContent ?? '') !== '',
            )
        const cursor = () => canvasElement.querySelector('[data-cursor]')
        await expect(untyped().length).toBeGreaterThan(0)
        // Typing: one cursor, holding still (no blink mid-keystroke), zero width.
        await expect(cursor()).not.toBeNull()
        await expect(
            getComputedStyle(cursor()!.firstElementChild!).animationName,
        ).toBe('none')
        await expect(cursor()!.getBoundingClientRect().width).toBe(0)
        await waitFor(() => expect(untyped().length).toBe(0), { timeout: 4000 })
        await expect(words(heading)).toBe(TYPING_TITLE)
        // Done: the cursor rests at the end of the body and blinks.
        const body = heading.nextElementSibling!
        await expect(body.contains(cursor())).toBe(true)
        await waitFor(() =>
            expect(
                getComputedStyle(cursor()!.firstElementChild!).animationName,
            ).not.toBe('none'),
        )
    },
}
