// Visual spec for <PaneDropZone> — the two drop affordances a pane leaf shows mid-drag: the
// four-quadrant split highlight (`left`/`right`/`up`/`down`/`center`) and the chat-reference cue.
// Six stories for six rules NO OTHER story in this repo can reach — `.pane-dropzone` and
// `.pane-drop-reference` only ever render while a real pointer drag is in flight over a pane, which
// Storybook cannot simulate. Without these, the whole family would have zero coverage and a broken
// migration would ship green.
//
// WHY THIS FILE EXISTS: recorded BEFORE `.pane-dropzone` + its five position variants and
// `.pane-drop-reference`/`.pane-drop-reference-cue` move from App.css into the shared
// PaneTree.module.css (Task 12's CSS half). See the plan's THE RECIPE for why the recording order
// is load-bearing.
//
// SIZED WRAPPER: both shapes are `position: absolute; inset: …`, so every story wraps in a
// `position: relative` box with real dimensions.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PaneDropZone } from './PaneDropZone'
import type { Zone } from './dnd/geometry'

const meta = {
    title: 'App/PaneDropZone',
    component: PaneDropZone,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PaneDropZone>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            position: 'relative',
            width: '320px',
            height: '220px',
            background: 'var(--bg-elevated, var(--bg))',
            border: '1px solid var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

const zoneStory = (zone: Zone): Story => ({
    render: () => (
        <Wrap>
            <PaneDropZone zone={zone} />
        </Wrap>
    ),
})

/** The left-edge split highlight. */
export const Left: Story = zoneStory('left')
/** The right-edge split highlight. */
export const Right: Story = zoneStory('right')
/** The top-edge split highlight. */
export const Up: Story = zoneStory('up')
/** The bottom-edge split highlight. */
export const Down: Story = zoneStory('down')
/** The whole-pane "replace" highlight — `.pane-dropzone.center` covers the full leaf via `inset: 0`
 *  with a stronger tint than the edge zones. */
export const Center: Story = zoneStory('center')

/** The chat-reference drop cue (Row 74): shown instead of a split zone when the drag payload is a
 *  referenceable file/folder over an open chat pane. */
export const Reference: Story = {
    render: () => (
        <Wrap>
            <PaneDropZone reference={true} />
        </Wrap>
    ),
}
