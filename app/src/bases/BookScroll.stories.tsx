// Visual spec for <BookScroll> — a book read as one long column. Faces are canvases drawn here
// (typeset book pages from _bookPages.ts, each with its page number) so every story is
// deterministic and touches no network.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, waitFor } from 'storybook/test'
import type { BookLeaf } from '../../../core/src/bases/bookPages'
import type { Face } from './bookFaces'
import BookScroll from './BookScroll'
import { bookPage } from './_bookPages'

const PAGE = { w: 450, h: 600 }

const leaves = (n: number): BookLeaf[] =>
    Array.from({ length: n }, (_, i) => ({ ref: { file: `scan ${i + 1}.png`, kind: 'image', rowIndex: i } }))

/** Page `n` (1-based) of the fixture book with its number at the foot. */
const numbered = (n: number): HTMLCanvasElement => {
    const c = bookPage(n, PAGE)
    const g = c.getContext('2d')!
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#8A877F'
    g.font = `${Math.round(c.height / 40)}px serif`
    g.textAlign = 'center'
    g.fillText(String(n), c.width / 2, c.height - c.height / 30)
    g.restore()
    return c
}

const readyFace = (leaf: BookLeaf): Promise<Face> =>
    Promise.resolve({ kind: 'ready', source: numbered(leaf.ref.rowIndex + 1) })

const scrollRoot = (canvasElement: HTMLElement) => canvasElement.querySelector<HTMLElement>('[data-book-scroll]')!
const pageEl = (canvasElement: HTMLElement, i: number) =>
    canvasElement.querySelector<HTMLElement>(`[data-book-scroll-page="${i}"]`)!

/** How far page `i`'s top sits from the top of the scroll view, in px. */
const offsetFromTop = (canvasElement: HTMLElement, i: number) =>
    pageEl(canvasElement, i).getBoundingClientRect().top - scrollRoot(canvasElement).getBoundingClientRect().top

/** Two frames: the mount's requestAnimationFrame scroll to `target` has run. */
const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

const meta = {
    title: 'Bases/BookScroll',
    component: BookScroll,
    parameters: { layout: 'centered' },
    decorators: [
        Story => (
            <div style={{ display: 'flex', 'flex-direction': 'column', width: '700px', height: '600px' }}>
                <Story />
            </div>
        ),
    ],
    args: {
        leaves: leaves(6),
        face: readyFace,
        aspect: PAGE.w / PAGE.h,
        target: 0,
        onPage: fn(),
    },
} satisfies Meta<typeof BookScroll>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    play: async ({ canvasElement, args }) => {
        await expect(canvasElement.querySelectorAll('[data-book-scroll-page]').length).toBe(6)
        await settle()
        const root = scrollRoot(canvasElement)
        root.scrollTop += offsetFromTop(canvasElement, 2)
        root.dispatchEvent(new Event('scroll'))
        await waitFor(() => expect(args.onPage).toHaveBeenLastCalledWith(2))
        await expect(Math.abs(offsetFromTop(canvasElement, 2))).toBeLessThan(2)
    },
}

export const MissingPage: Story = {
    name: 'Missing page',
    args: {
        face: (leaf: BookLeaf): Promise<Face> =>
            leaf.ref.rowIndex === 1 ? Promise.resolve({ kind: 'missing', name: 'gone.png' }) : readyFace(leaf),
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(pageEl(canvasElement, 1).textContent).toBe('missing: gone.png'))
        await expect(pageEl(canvasElement, 1).querySelector('canvas')).toBeNull()
        await expect(pageEl(canvasElement, 0).querySelector('canvas')).not.toBeNull()
    },
}

export const Target: Story = {
    args: { target: 3 },
    play: async ({ canvasElement }) => {
        await settle()
        await waitFor(() => expect(Math.abs(offsetFromTop(canvasElement, 3))).toBeLessThan(2))
    },
}
