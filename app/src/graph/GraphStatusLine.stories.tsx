import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import GraphStatusLine from './GraphStatusLine'

const meta = {
    title: 'Graph/GraphStatusLine',
    component: GraphStatusLine,
} satisfies Meta<typeof GraphStatusLine>
export default meta
type Story = StoryObj<typeof meta>

const LONG_PATH =
    'archive/CYPLAN 114/notes/2026-03-10 reading - Temporary to Transformative (R. Page 3).md'

/** The strip is absolutely positioned on its parent's floor, so each story gives it a graph-sized
 *  field to sit in — the frame stands in for `.graph-area`. */
const Field = (props: { width: string; children: any }) => (
    <div
        style={{
            position: 'relative',
            width: props.width,
            height: '120px',
            background: 'var(--bg)',
        }}
    >
        {props.children}
    </div>
)

const readout = { nodes: 2262, edges: 5274, mode: 'both brains', zoom: 100 }

/** Hovering a note: folder faint, file name in fg, readout faint on the right. */
export const Hovering: Story = {
    render: () => (
        <Field width="900px">
            <GraphStatusLine hover="reading/quotes/On Attention.md" {...readout} />
        </Field>
    ),
}

/** Nothing hovered: the left side is empty, the readout does not move. */
export const Idle: Story = {
    render: () => (
        <Field width="900px">
            <GraphStatusLine {...readout} />
        </Field>
    ),
}

/** A path longer than the room: the FOLDER ellipsizes first, the file name survives, and the
 *  readout never shrinks or gets painted over. */
export const LongPath: Story = {
    render: () => (
        <Field width="640px">
            <GraphStatusLine hover={LONG_PATH} {...readout} />
        </Field>
    ),
    play: async ({ canvasElement }) => {
        const path = canvasElement.querySelector('[data-testid="graph-status-path"]')!
        const out = canvasElement.querySelector('[data-testid="graph-status-readout"]')!
        expect(path.getBoundingClientRect().right).toBeLessThanOrEqual(
            out.getBoundingClientRect().left,
        )
        expect(out.textContent).toBe('2262 nodes // 5274 edges // both brains // 100%')
    },
}

/** A label with no folder (a memory or tag node) is all name. */
export const BareLabel: Story = {
    render: () => (
        <Field width="900px">
            <GraphStatusLine hover="prefers terse commit messages" {...readout} mode="3rd brain" />
        </Field>
    ),
}

/** fps on, one row per traffic-light band: smooth, usable, janky. */
export const WithFps: Story = {
    render: () => (
        <div style={{ display: 'grid', gap: '8px' }}>
            <Field width="900px">
                <GraphStatusLine hover="reading/quotes/On Attention.md" {...readout} fps={60} />
            </Field>
            <Field width="900px">
                <GraphStatusLine {...readout} zoom={250} fps={38} />
            </Field>
            <Field width="900px">
                <GraphStatusLine {...readout} zoom={50} fps={14} />
            </Field>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const outs = [...canvasElement.querySelectorAll('[data-testid="graph-status-readout"]')]
        expect(outs[0]!.textContent).toBe(
            '2262 nodes // 5274 edges // both brains // 100% // 60 fps',
        )
    },
}
