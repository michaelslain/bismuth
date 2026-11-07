// Visual spec for <NoteProse> — markdown shown exactly as a note shows it, read-only: the note
// editor's own CodeMirror stack fed a string. Headings, bullets at every depth, code, a table and
// the fold triangles are all the note's.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import NoteProse from './NoteProse'
import { foldArrows, noteProseReady } from './_noteProseReady'

const meta = {
    title: 'UI/NoteProse',
    component: NoteProse,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof NoteProse>

export default meta
type Story = StoryObj<typeof meta>

const TEXT = [
    '## Plan',
    '',
    'Ship the fold in **two** steps.',
    '',
    '- read the note view',
    '    - its fold triangles',
    '        - at every depth',
    '- reuse it',
    '',
    '```ts',
    'const done = true',
    '```',
    '',
    '| step | state |',
    '| --- | --- |',
    '| read | done |',
].join('\n')

/** A note's markdown, read-only: no caret, so nothing reveals raw markup; the folds work. */
export const Note: Story = {
    render: () => (
        <div style={{ width: '420px', 'padding-left': '40px' }}>
            <NoteProse text={TEXT} foldKey="story:note-prose" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await noteProseReady(canvasElement)
        await expect(
            canvasElement.querySelector('.cm-content'),
        ).toHaveAttribute('contenteditable', 'false')
        const arrows = foldArrows(canvasElement)
        await expect(arrows.has('h|2|Plan|0')).toBe(true)
        await expect(arrows.has('l|its fold triangles|0')).toBe(true)
        await userEvent.click(arrows.get('l|its fold triangles|0')!)
        await waitFor(() =>
            expect(
                canvas.queryByText(/at every depth/),
            ).not.toBeInTheDocument(),
        )
        await expect(canvas.getByText(/reuse it/)).toBeInTheDocument()
    },
}

/** `lazy`: the plain text holds the room until the view nears the viewport, then the note view
 *  replaces it. */
export const Lazy: Story = {
    render: () => (
        <div style={{ width: '420px', 'padding-left': '40px' }}>
            <NoteProse text={TEXT} foldKey="story:note-prose-lazy" lazy />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        // The placeholder is gone: the host holds only the view's own element.
        const host = canvasElement.querySelector('[data-note-prose]')!
        await expect(host.children).toHaveLength(1)
    },
}
