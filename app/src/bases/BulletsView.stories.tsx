// Visual spec for <BulletsView> — the plain markdown-style bullet list renderer. Exercises
// `sampleViewResult` end to end: real rows, run through the real query engine
// (core/src/bases/query.ts `runView`), rendered by the real BulletsView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { BulletsView } from './BulletsView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/BulletsView',
    component: BulletsView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BulletsView>

export default meta
type Story = StoryObj<typeof meta>

/** The curated sample dataset as a flat bullet list — one `<li>` per row, first column only. */
export const Default: Story = {
    render: () => (
        <BulletsView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
}

/** Grouped by `status` — a group heading per distinct value, same `ResultGroup` shape
 *  kanban/table use, rendered here as sub-headed bullet lists instead of columns/rows. */
export const Grouped: Story = {
    render: () => {
        const views = [
            {
                type: 'bullets' as const,
                name: 'Bullets',
                groupBy: { property: 'status' },
            },
        ]
        return (
            <BulletsView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}
