// Visual spec for <BookSpread> — the still pages of an open book. Faces are canvases drawn here
// (typeset book pages from _bookPages.ts) so every story is deterministic.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import BookSpread from './BookSpread'
import { bookPage } from './_bookPages'

const PAGE = { w: 300, h: 400 }

const meta = {
    title: 'Bases/BookSpread',
    component: BookSpread,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof BookSpread>

export default meta
type Story = StoryObj<typeof meta>


const face = (n: number): HTMLCanvasElement => bookPage(n, PAGE)

const noop = () => {}

export const Spread: Story = {
    args: {
        layout: 'spread',
        pageSize: PAGE,
        faces: { left: face(2), right: face(3) },
        onTurn: noop,
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-book-page]').length).toBe(2)
    },
}

export const Cover: Story = {
    args: {
        layout: 'spread',
        pageSize: PAGE,
        faces: { left: null, right: face(1) },
        onTurn: noop,
    },
    play: async ({ canvasElement }) => {
        await expect(getComputedStyle(canvasElement.querySelector('[data-book-page="left"]')!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    },
}

export const LastPageAlone: Story = {
    args: {
        layout: 'spread',
        pageSize: PAGE,
        faces: { left: face(6), right: null },
        onTurn: noop,
    },
    play: async ({ canvasElement }) => {
        await expect(getComputedStyle(canvasElement.querySelector('[data-book-page="right"]')!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    },
}

export const Single: Story = {
    args: {
        layout: 'single',
        pageSize: PAGE,
        faces: { left: null, right: face(4) },
        onTurn: noop,
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-book-page]').length).toBe(1)
    },
}

export const MissingPage: Story = {
    args: {
        layout: 'spread',
        pageSize: PAGE,
        faces: { left: face(2), right: null },
        missing: { right: 'scan 3.jpg' },
        onTurn: noop,
    },
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('missing: scan 3.jpg')).toBeInTheDocument()
    },
}

/** A click in a page's outer third turns it; the middle of a page does nothing. */
export const ClickOuterThird: Story = {
    args: {
        layout: 'spread',
        pageSize: PAGE,
        faces: { left: face(2), right: face(3) },
        onTurn: fn(),
    },
    play: async ({ canvasElement, args }) => {
        const left = canvasElement.querySelector<HTMLElement>('[data-book-page="left"]')!
        const right = canvasElement.querySelector<HTMLElement>('[data-book-page="right"]')!
        const at = (el: HTMLElement, f: number) => {
            const r = el.getBoundingClientRect()
            return { clientX: r.left + r.width * f, clientY: r.top + r.height / 2 }
        }
        await userEvent.pointer({ keys: '[MouseLeft]', target: right, coords: at(right, 0.5) })
        await expect(args.onTurn).not.toHaveBeenCalled()
        await userEvent.pointer({ keys: '[MouseLeft]', target: right, coords: at(right, 0.9) })
        await expect(args.onTurn).toHaveBeenLastCalledWith(1)
        await userEvent.pointer({ keys: '[MouseLeft]', target: left, coords: at(left, 0.1) })
        await expect(args.onTurn).toHaveBeenLastCalledWith(-1)
    },
}
