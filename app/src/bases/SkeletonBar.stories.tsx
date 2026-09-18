// Visual spec for <SkeletonBar> — the single placeholder-bar primitive TableSkeleton and
// CardsSkeleton compose their silhouettes from. `class` layers on sizing; this story shows
// the bare shape plus one sized example.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { SkeletonBar } from './SkeletonBar'

const meta = {
    title: 'Bases/SkeletonBar',
    component: SkeletonBar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof SkeletonBar>

export default meta
type Story = StoryObj<typeof meta>

/** The bare bar with no sizing class — a 1em-tall block at its container's width. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '200px', height: '16px' }}>
            <SkeletonBar />
        </div>
    ),
}

/** A sized bar, as a caller composes it — here via a `class` that fixes height and width,
 *  the way TableSkeleton's `.cell` or CardsSkeleton's `.cardLine` do. */
export const Sized: Story = {
    render: () => (
        <div>
            <style>{'.storySized { height: 11px; width: 160px; }'}</style>
            <SkeletonBar class="storySized" />
        </div>
    ),
}
