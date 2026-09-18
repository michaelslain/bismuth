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

/** A sized bar, as a caller composes it — `class` supplies height/width, the way
 *  TableSkeleton's `.cell` or CardsSkeleton's `.cardLine` do. SkeletonBar itself carries
 *  no intrinsic size, so a story without a sizing class would render 0×0. */
export const Default: Story = {
    render: () => (
        <div>
            <style>{'.storyDefault { height: 11px; width: 160px; }'}</style>
            <SkeletonBar class="storyDefault" />
        </div>
    ),
}

/** A shorter, narrower bar — the shape TableSkeleton's `.headCell` and CardsSkeleton's
 *  `.cardLine` use for secondary text lines. */
export const Sized: Story = {
    render: () => (
        <div>
            <style>{'.storySized { height: 9px; width: 90px; }'}</style>
            <SkeletonBar class="storySized" />
        </div>
    ),
}
