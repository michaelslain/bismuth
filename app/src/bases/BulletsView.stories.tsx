// Visual spec for <BulletsView> — the plain markdown-style bullet list renderer. Exercises
// `sampleViewResult` end to end: real rows, run through the real query engine
// (core/src/bases/query.ts `runView`), rendered by the real BulletsView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { BulletsView } from './BulletsView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Row, BaseConfig } from '../../../core/src/bases/types'
import { runView } from '../../../core/src/bases/query'

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
    // A bullet must open its row (the bug this fix addresses: BulletsView used to render a
    // bare, unclickable `renderValue` for every row). A note row's bullet is a live anchor.
    play: async ({ canvasElement }) => {
        const link = canvasElement.querySelector('li a')
        expect(link).toBeTruthy()
    },
}

// A row STORED in a base's own body (see TableView.stories.tsx's STORED_CONFIG for the shape).
const STORED_CONFIG: BaseConfig = {
    declaredProperties: ['description', 'status'],
    views: [{ type: 'bullets', name: 'Bullets' }],
}
const STORED_ROWS: Row[] = [
    {
        file: syntheticBaseFile('boards/stored-bullets.md'),
        note: { description: 'ship the parser', status: 'Todo' },
        formula: {},
        index: 0,
    },
]

/** With `basePath` set (openRowEditor.tsx wired), an owned row's bullet becomes a real button
 *  that opens the row editor — it has no note of its own to open. */
export const EditableOwnedRow: Story = {
    render: () => (
        <BulletsView
            result={runView(STORED_CONFIG, STORED_ROWS, 0)}
            config={STORED_CONFIG}
            basePath="boards/stored-bullets.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('li button')
        expect(btn).toBeTruthy()
        expect((btn!.textContent ?? '')).toContain('ship the parser')

        const li = canvasElement.querySelector('li')!
        li.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
}

/** With `basePath` set, a note row's bullet keeps opening the note on click; right-click on
 *  the row opens the property editor. */
export const EditableNoteRow: Story = {
    render: () => (
        <BulletsView
            result={sampleViewResult()}
            config={sampleBaseConfig()}
            basePath="projects/tasks.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const li = canvasElement.querySelector('li')!
        li.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
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
