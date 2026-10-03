// Visual spec for <IntroCopy> — the first-run intro's headline + paragraph block, in the prose
// face: a 48px regular-weight headline (40px below 980px) over a 19px, 34em-measure paragraph.
//
// Props: title, body, backdrop (the graph is painted directly behind the copy: --bg text halo +
// radial scrim), type (type the text in on mount; default on — every story but `Typing` turns it
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
        backdrop: { control: 'boolean' },
        type: { control: 'boolean' },
    },
} satisfies Meta<typeof IntroCopy>

export default meta
type Story = StoryObj<typeof meta>

/** The welcome slide's copy — the everyday state, no graph behind it. */
export const Default: Story = {
    args: {
        title: 'Notes that think.',
        body: 'Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.',
        type: false,
    },
}

/** `backdrop` on, over a --surface-1 box so the scrim and text halo are visible against
 *  something that is not the page background. */
export const Backdrop: Story = {
    args: {
        title: 'Three brains, one mind.',
        body: "Your notes and Bismuth's memory connect into one graph, so what you know and what it learns stay woven together.",
        backdrop: true,
        type: false,
    },
    render: args => (
        <div
            style={{
                background: 'var(--surface-1)',
                padding: '96px 160px',
            }}
        >
            <IntroCopy {...args} />
        </div>
    ),
}

/** The agents slide's long body — the longest paragraph in the flow, to check the 34em measure. */
export const LongBody: Story = {
    args: {
        title: 'Bring your own agent.',
        body: 'Chat runs on whichever coding agent you already use — Claude Code, Codex, Gemini, opencode, Cline, Goose. Bismuth speaks MCP, so any of them can search the docs and write your bases, queries and notes.',
        type: false,
    },
}

const TYPING_TITLE = 'Notes that think.'
const TYPING_BODY =
    'Write notes and connect them with [[wikilinks]]. Bismuth links them into a graph you can explore and search.'

/** The default: the text types in on mount, headline first. The full text is in the DOM from the
 *  first frame (the untyped remainder is only `visibility: hidden`), so nothing reflows. The
 *  screenshot of this story is a mid-type frame — the stable looks are the stories above. */
export const Typing: Story = {
    args: { title: TYPING_TITLE, body: TYPING_BODY },
    play: async ({ canvasElement }) => {
        const heading = canvasElement.querySelector('h1')!
        // Whole from the first frame, whatever has been typed so far.
        await expect(heading.textContent).toBe(TYPING_TITLE)
        // The CSS-module class is hashed, so match on the local name it keeps.
        const untyped = () =>
            [...canvasElement.querySelectorAll('[class*="untyped"]')].filter(
                el => (el.textContent ?? '') !== '',
            )
        await waitFor(() => expect(untyped().length).toBe(0), { timeout: 3000 })
        await expect(heading.textContent).toBe(TYPING_TITLE)
    },
}
