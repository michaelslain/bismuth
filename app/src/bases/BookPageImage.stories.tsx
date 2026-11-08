// Visual spec for <BookPageImage>: one page picture in side by side, painted from its face onto a
// canvas, with the locate boxes over it; and the fallback when the page's file is missing. The
// face is a canvas drawn here, standing in for a decoded page image.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { PDF_PAGE_PAPER, PDF_PAGE_RULE } from '../../../core/src/theme/tokens'
import type { Face } from './bookFaces'
import type { LocateBox } from './LocateLayer'
import BookPageImage from './BookPageImage'

const meta = {
    title: 'Bases/BookPageImage',
    component: BookPageImage,
} satisfies Meta<typeof BookPageImage>

export default meta
type Story = StoryObj<typeof meta>

/** A ruled page: paper with a few text-like bars. */
const ruledPage = (): Face => {
    const c = document.createElement('canvas')
    c.width = 600
    c.height = 800
    const g = c.getContext('2d')!
    g.fillStyle = PDF_PAGE_PAPER
    g.fillRect(0, 0, c.width, c.height)
    g.fillStyle = PDF_PAGE_RULE
    for (let y = 120; y < 700; y += 40) g.fillRect(60, y, y % 120 === 0 ? 320 : 480, 14)
    return { kind: 'ready', source: c }
}

const BOXES: LocateBox[] = [
    { x: 0.1, y: 0.15, w: 0.8, h: 0.03 },
    { x: 0.1, y: 0.2, w: 0.53, h: 0.03 },
]

/** The row gives the picture a positioned box of the page's aspect. */
const Slot = (props: { face: () => Promise<Face>; boxes: LocateBox[] }) => (
    <div style={{ position: 'relative', width: '300px', 'aspect-ratio': '0.75' }}>
        <BookPageImage face={props.face} label="page 1" boxes={props.boxes} />
    </div>
)

/** The face is painted onto the canvas, with two locate boxes over it. */
export const Ready: Story = {
    args: { face: async () => ruledPage(), label: 'page 1', boxes: BOXES },
    render: () => <Slot face={async () => ruledPage()} boxes={BOXES} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('canvas')?.width).toBe(600))
        await expect(canvasElement.querySelectorAll('[data-locate-box]').length).toBe(2)
    },
}

/** The page's file is gone: the name is shown in place of the picture. */
export const Missing: Story = {
    args: { face: async () => ({ kind: 'missing', name: 'scan-012.png' }), label: 'page 12', boxes: [] },
    render: () => <Slot face={async () => ({ kind: 'missing', name: 'scan-012.png' })} boxes={[]} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.textContent).toContain('missing: scan-012.png'))
        await expect(canvasElement.querySelector('canvas')).toBeNull()
    },
}
