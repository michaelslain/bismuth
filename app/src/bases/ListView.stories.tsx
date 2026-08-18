// Visual spec for <ListView> — the compact row-list renderer (also handles task rows with
// native checkbox glyphs). Exercises `sampleViewResult` end to end: real rows, run through the
// real query engine (core/src/bases/query.ts `runView`), rendered by the real ListView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ListView } from './ListView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/ListView',
    component: ListView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ListView>

export default meta
type Story = StoryObj<typeof meta>

/** The curated sample dataset (text/number/checkbox/date/select/multiselect columns). */
export const Default: Story = {
    render: () => (
        <ListView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
}

/** Grouped by `status` — a colored group heading + row count per distinct value. */
export const Grouped: Story = {
    render: () => {
        const views = [
            {
                type: 'list' as const,
                name: 'List',
                groupBy: { property: 'status' },
            },
        ]
        return (
            <ListView
                result={sampleViewResult(undefined, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}
