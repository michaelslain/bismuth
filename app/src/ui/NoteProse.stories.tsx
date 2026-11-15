// Visual spec for <NoteProse> — markdown shown exactly as a note shows it, read-only: the note
// editor's own CodeMirror stack fed a string. Headings, bullets at every depth, code, a table and
// the fold triangles are all the note's.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import NoteProse from './NoteProse'
import { setTransport } from '../api'
import { fakeTransport } from './_fakeTransport'
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

const SOURCE_NOTE = [
    '---',
    'tags: [kitchen]',
    '---',
    '# Bread',
    '',
    'A plain loaf, written down once.',
    '',
    '## Dough',
    '',
    'Mix flour, water and salt.',
    '',
    '### Resting',
    '',
    'Leave it for an hour.',
    '',
    '## Baking',
    '',
    'Bake at 230 degrees for forty minutes. ^bake-time',
    '',
    '- score the top',
    '- steam the oven ^steam',
    '- cool on a rack',
].join('\n')

const EMBED_TEXT = [
    'This note marks its own blocks too. ^own-block',
    '',
    'A section of a note:',
    '',
    '![[Bread#Dough]]',
    '',
    'One block of it:',
    '',
    '![[Bread#^bake-time]]',
    '',
    'One list item:',
    '',
    '![[Bread#^steam]]',
    '',
    'The whole note:',
    '',
    '![[Bread]]',
    '',
    '| recipe | link |',
    '| --- | --- |',
    '| loaf | [[Bread\\|the loaf]] |',
].join('\n')

const BREAD = [{ label: 'Bread', path: 'Bread.md' }]

/** Embeds of one note: `![[Note#Heading]]` shows that heading's section (its subheadings too),
 *  `![[Note#^id]]` the one block or list item marked `^id`, `![[Note]]` the whole note; a
 *  table link written the Obsidian way, `[[Note\|Alias]]`, shows the alias; a block id
 *  (` ^id`) never shows. */
export const Embeds: Story = {
    render: () => {
        setTransport(fakeTransport({ files: { 'Bread.md': SOURCE_NOTE } }))
        return (
            <div style={{ width: '520px', 'padding-left': '40px' }}>
                <NoteProse
                    text={EMBED_TEXT}
                    foldKey="story:note-prose-embeds"
                    noteNames={() => BREAD}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        await noteProseReady(canvasElement)
        const bodies = () =>
            Array.from(
                canvasElement.querySelectorAll<HTMLElement>('.cm-embed-note-body'),
            ).map(b => b.textContent ?? '')
        await waitFor(() => expect(bodies().every(b => b !== '…')).toBe(true))
        const [section, block, item, whole] = bodies()
        await expect(section).toContain('Mix flour')
        await expect(section).toContain('Leave it for an hour')
        await expect(section).not.toContain('Bake at')
        await expect(block).toContain('Bake at 230')
        await expect(block).not.toContain('^bake-time')
        await expect(block).not.toContain('score the top')
        await expect(item).toContain('steam the oven')
        await expect(item).not.toContain('cool on a rack')
        await expect(whole).toContain('A plain loaf')
        await expect(whole).toContain('cool on a rack')
        await expect(within(canvasElement).getByText('the loaf')).toBeInTheDocument()
        // The note's own block id hides in live preview too.
        const firstLine = canvasElement.querySelector<HTMLElement>('.cm-line')!
        await expect(firstLine.innerText).toContain('marks its own blocks too.')
        await expect(firstLine.innerText).not.toContain('^own-block')
    },
}
