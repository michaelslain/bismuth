// Visual spec for <SideBySide>: page image left, its text right, one scroller. Rows are a white page
// div (the row's aspect) holding a LocateLayer, beside a plain text block; the component itself
// knows neither. `data-row-key` marks each row for the scroll-follow assertions.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, waitFor } from 'storybook/test'
import { PDF_PAGE_PAPER } from '../../../core/src/theme/tokens'
import LocateLayer, { type LocateBox } from './LocateLayer'
import SideBySide, { type SideBySideRow } from './SideBySide'

const meta = {
    title: 'Bases/SideBySide',
    component: SideBySide,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SideBySide>

export default meta
type Story = StoryObj<typeof meta>

const PARAGRAPH =
    'The mitochondria is the powerhouse of the cell. Energy is made here, and carried out as ATP to every part of the cell that needs it.'

const rowsOf = (n: number, boxes: Record<string, LocateBox[]> = {}): SideBySideRow[] =>
    Array.from({ length: n }, (_, i) => {
        const key = `p${i + 1}`
        return {
            key,
            aspect: 0.75,
            image: () => (
                <div style={{ position: 'absolute', inset: '0', background: PDF_PAGE_PAPER }}>
                    <LocateLayer boxes={boxes[key] ?? []} />
                </div>
            ),
            text: () => (
                <div style={{ 'font-size': 'var(--fs-ui)', color: 'var(--text)' }}>
                    <div style={{ color: 'var(--text-muted)', 'border-bottom': '1px solid var(--border)' }}>page {i + 1}</div>
                    <p>{PARAGRAPH}</p>
                    <p>{PARAGRAPH}</p>
                </div>
            ),
        }
    })

const Frame = (props: { width?: number; children: any }) => (
    <div style={{ width: props.width ? `${props.width}px` : '100%', height: '640px', 'max-width': 'none' }}>
        {props.children}
    </div>
)

/** Wide pane: image and text side by side, rows 32px apart. */
export const Wide: Story = {
    args: { rows: [] },
    render: () => (
        <Frame>
            <SideBySide rows={rowsOf(4)} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('[data-row-key]') as HTMLElement
        const [img, txt] = [row.children[0] as HTMLElement, row.children[1] as HTMLElement]
        await expect(img.getBoundingClientRect().top).toBe(txt.getBoundingClientRect().top)
        await expect(txt.getBoundingClientRect().left).toBeGreaterThan(img.getBoundingClientRect().right)
        const rows = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-row-key]'))
        await expect(rows.length).toBeGreaterThan(1)
        await expect(rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom).toBe(32)
    },
}

/** 640px pane: below 720 the picture stays beside its text, giving up width to it. */
export const Narrow640: Story = {
    name: 'Narrow 640',
    args: { rows: [] },
    render: () => (
        <Frame width={640}>
            <SideBySide rows={rowsOf(3)} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('[data-row-key]') as HTMLElement
        const [img, txt] = [row.children[0] as HTMLElement, row.children[1] as HTMLElement]
        const [i, t] = [img.getBoundingClientRect(), txt.getBoundingClientRect()]
        await expect(t.left).toBeGreaterThanOrEqual(i.right)
        await expect(t.top).toBeLessThan(i.bottom)
        await expect(i.width).toBeLessThan(t.width)
    },
}

/** A row with located lines drawn over its image. */
export const Located: Story = {
    args: { rows: [] },
    render: () => (
        <Frame>
            <SideBySide
                rows={rowsOf(2, {
                    p1: [
                        { x: 0.1, y: 0.2, w: 0.8, h: 0.04 },
                        { x: 0.1, y: 0.25, w: 0.55, h: 0.04 },
                    ],
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-locate-box]').length).toBe(2)
    },
}

/** `at` scrolls to a row, and `onAt` reports the row at the top as the scroller moves. */
export const FollowsRow: Story = {
    name: 'Follows row',
    args: { rows: [] },
    render: () => {
        const [seen, setSeen] = createSignal('')
        return (
            <Frame>
                <div data-testid="seen" style={{ position: 'absolute', right: '8px', top: '8px', 'z-index': 1 }}>
                    {seen()}
                </div>
                <SideBySide rows={rowsOf(6)} at={{ key: 'p3' }} onAt={a => setSeen(a.key)} />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const seen = () => canvasElement.querySelector('[data-testid="seen"]')!.textContent
        const scroller = canvasElement.querySelector('[data-side-by-side]') as HTMLElement
        const row = (k: string) => canvasElement.querySelector(`[data-row-key="${k}"]`) as HTMLElement
        // `at` put p3 at the top
        await waitFor(() => expect(Math.abs(row('p3').offsetTop - scroller.scrollTop)).toBeLessThan(2))
        await new Promise(r => requestAnimationFrame(() => r(null)))
        // a user scroll back to the top reports the first row
        scroller.scrollTop = 0
        await waitFor(() => expect(seen()).toBe('p1'))
        scroller.scrollTop = row('p4').offsetTop + 4
        await waitFor(() => expect(seen()).toBe('p4'))
    },
}
