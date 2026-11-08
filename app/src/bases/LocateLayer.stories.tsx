// Visual spec for <LocateLayer>: boxes over a page, and clicks reported as page fractions. The
// page is a white div of a fixed aspect, standing in for the page image.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, within } from 'storybook/test'
import { PDF_PAGE_PAPER } from '../../../core/src/theme/tokens'
import LocateLayer, { type LocateBox } from './LocateLayer'

const meta = {
    title: 'Bases/LocateLayer',
    component: LocateLayer,
} satisfies Meta<typeof LocateLayer>

export default meta
type Story = StoryObj<typeof meta>

const BOXES: LocateBox[] = [
    { x: 0.1, y: 0.2, w: 0.8, h: 0.04 },
    { x: 0.1, y: 0.25, w: 0.5, h: 0.04 },
]

const Page = (props: { boxes: LocateBox[]; onPoint?: (x: number, y: number) => void }) => (
    <div
        data-testid="page"
        style={{ position: 'relative', width: '300px', 'aspect-ratio': '0.75', background: PDF_PAGE_PAPER }}
    >
        <LocateLayer boxes={props.boxes} onPoint={props.onPoint} />
    </div>
)

/** Two boxes drawn over the page. */
export const WithBoxes: Story = {
    name: 'With boxes',
    args: { boxes: BOXES },
    render: () => <Page boxes={BOXES} />,
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-locate-box]').length).toBe(2)
    },
}

/** No boxes: nothing is drawn. */
export const Empty: Story = {
    args: { boxes: [] },
    render: () => <Page boxes={[]} />,
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-locate-box]').length).toBe(0)
    },
}

/** A click reports where it landed as fractions of the page. */
export const ReportsPoint: Story = {
    name: 'Reports point',
    args: { boxes: [] },
    render: () => {
        const [pt, setPt] = createSignal('none')
        return (
            <div>
                <Page boxes={[]} onPoint={(x, y) => setPt(`${x.toFixed(2)},${y.toFixed(2)}`)} />
                <div data-testid="point">{pt()}</div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const page = within(canvasElement).getByTestId('page')
        const r = page.getBoundingClientRect()
        const layer = page.querySelector('[data-locate-layer]') as HTMLElement
        layer.dispatchEvent(
            new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.25 }),
        )
        await expect(within(canvasElement).getByTestId('point').textContent).toBe('0.50,0.25')
    },
}
