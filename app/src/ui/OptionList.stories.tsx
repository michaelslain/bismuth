// Visual spec for <OptionList> — the grouped panel a set of <OptionRow>s lives in. See
// OptionList.tsx for why the rows stopped carrying their own background and border.
//
// The point of these stories is the SEAM between rows, which is the whole reason the component
// exists: one panel with hairlines, matching `.cat-group` / `.set-cols` / `.propset-list`, rather
// than N floating cards.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { OptionList } from './OptionList'
import OptionRow from './OptionRow'

const meta = {
    title: 'UI/OptionList',
    component: OptionList,
    parameters: { layout: 'padded' },
    args: { children: null },
} satisfies Meta<typeof OptionList>

export default meta
type Story = StoryObj<typeof meta>

const shell = { width: '380px' }

/** RecurrenceDialog's three scopes — the shape the component was extracted for. */
export const ThreeRows: Story = {
    render: () => (
        <div style={shell}>
            <OptionList>
                <OptionRow
                    icon="CircleCheck"
                    label="This event"
                    sublabel="Only Sep 11, 2026"
                    onClick={() => {}}
                />
                <OptionRow
                    icon="ArrowRight"
                    label="This and following events"
                    sublabel="Sep 11, 2026 onward"
                    onClick={() => {}}
                />
                <OptionRow
                    icon="Calendar"
                    label="All events"
                    sublabel="The entire series"
                    onClick={() => {}}
                />
            </OptionList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll('button')]
        expect(rows.length).toBe(3)
        // Exactly two hairlines for three rows. Three would mean a border on every row (the boxed
        // look this replaced); zero would mean the separator rule stopped matching.
        const withTop = rows.filter(
            r => parseFloat(getComputedStyle(r).borderTopWidth) > 0,
        )
        expect(withTop.length).toBe(2)
        // One panel, one border: the container carries the surface the rows used to each carry.
        const panel = canvasElement.querySelector(
            '[class*="option-list"]',
        ) as HTMLElement
        expect(panel).not.toBeNull()
        expect(parseFloat(getComputedStyle(panel).borderTopWidth)).toBeGreaterThan(0)
        expect(getComputedStyle(panel).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    },
}

/** A single row draws no hairline at all — the separator is between rows, never above the first. */
export const SingleRow: Story = {
    render: () => (
        <div style={shell}>
            <OptionList>
                <OptionRow
                    icon="CircleCheck"
                    label="This event"
                    sublabel="Only Sep 11, 2026"
                    onClick={() => {}}
                />
            </OptionList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll('button')]
        expect(rows.length).toBe(1)
        expect(parseFloat(getComputedStyle(rows[0]!).borderTopWidth)).toBe(0)
    },
}

/** The delete-scope shape: every row destructive, inside the same neutral panel. The panel does NOT
 *  change with the tone — only the marks do. */
export const DangerRows: Story = {
    render: () => (
        <div style={shell}>
            <OptionList>
                <OptionRow
                    icon="CircleCheck"
                    label="This event"
                    sublabel="Only Sep 11, 2026"
                    danger
                    onClick={() => {}}
                />
                <OptionRow
                    icon="ArrowRight"
                    label="This and following events"
                    sublabel="Sep 11, 2026 onward"
                    danger
                    onClick={() => {}}
                />
                <OptionRow
                    icon="Calendar"
                    label="All events"
                    sublabel="The entire series"
                    danger
                    onClick={() => {}}
                />
            </OptionList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll('button')]
        expect(rows.length).toBe(3)
        for (const r of rows) expect(r.className).toMatch(/danger/)
        const marks = [
            ...canvasElement.querySelectorAll('[class*="option-ic"]'),
        ] as HTMLElement[]
        const hues = new Set(marks.map(m => getComputedStyle(m).color))
        expect(hues.size).toBe(1) // one destructive hue across the set, not a gradient of severity
    },
}
