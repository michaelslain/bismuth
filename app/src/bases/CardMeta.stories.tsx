// Visual spec for <CardMeta> — the extra property lines on a card, each value drawn by renderCell
// with the base config (declared number / multiselect / boolean look the same as in Table/List).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CardMeta from './CardMeta'
import {
    sampleBaseConfig,
    sampleViewResult,
    SAMPLE_ROWS,
} from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/CardMeta',
    component: CardMeta,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof CardMeta>

export default meta
type Story = StoryObj<typeof meta>

const config = sampleBaseConfig()
// Every resolved column after the title — the whole ordered meta set for the sample view.
const cols = sampleViewResult().columns.slice(1)

const Frame = (p: { children: any }) => (
    <div
        style={{
            width: '240px',
            padding: 'var(--sp-6)',
            border: '1px solid var(--border-soft)',
        }}
    >
        {p.children}
    </div>
)

/** All the sample view's meta columns for one row. */
export const Default: Story = {
    render: () => (
        <Frame>
            <CardMeta cols={cols} row={SAMPLE_ROWS[1]} config={config} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent ?? '').not.toBe('')
    },
}

/** A column the row has no value for is skipped — no label, no empty dash — while the others
 *  still render. */
export const SkipsEmptyValues: Story = {
    render: () => (
        <Frame>
            <CardMeta
                cols={['note.nothing', ...cols]}
                row={SAMPLE_ROWS[1]}
                config={config}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const text = canvasElement.textContent ?? ''
        expect(text).not.toContain('nothing')
        expect(text).not.toBe('')
    },
}
