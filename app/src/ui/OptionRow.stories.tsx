// Visual spec for <OptionRow> — the large single-choice row (icon tile + label + sublabel +
// chevron) RecurrenceDialog used to hand-roll as a bare `.rec-opt` button. See OptionRow.tsx's
// header comment for why this needed its own primitive rather than reusing TextButton/Button.
//
// Props: icon (registry name, required), label (required), sublabel (optional), danger
// (destructive tone), onClick (required), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { OptionRow } from './OptionRow'

const meta = {
    title: 'UI/OptionRow',
    component: OptionRow,
    parameters: { layout: 'padded' },
    args: {
        icon: 'CircleCheck',
        label: 'This event',
        onClick: () => {},
    },
} satisfies Meta<typeof OptionRow>

export default meta
type Story = StoryObj<typeof meta>

const shell = { width: '380px' }

/** Icon + label only, no sublabel, not danger. */
export const Default: Story = {
    render: () => (
        <div style={shell}>
            <OptionRow
                icon="CircleCheck"
                label="This event"
                onClick={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('button') as HTMLElement
        expect(row).not.toBeNull()
        expect(row.className).not.toMatch(/danger/)
        expect(
            canvasElement.querySelector('[class*="option-lab"]')!.textContent,
        ).toBe('This event')
        expect(canvasElement.querySelector('[class*="option-sub"]')).toBeNull()
        expect(canvasElement.querySelectorAll('svg').length).toBe(2) // icon tile + chevron
    },
}

/** Icon + label + sublabel — RecurrenceDialog's actual shape ("This and following events" /
 *  "This and following events onward"). */
export const Sublabel: Story = {
    render: () => (
        <div style={shell}>
            <OptionRow
                icon="ArrowRight"
                label="This and following events"
                sublabel="Tuesday, August 12 onward"
                onClick={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const sub = canvasElement.querySelector('[class*="option-sub"]')
        expect(sub).not.toBeNull()
        expect(sub!.textContent).toBe('Tuesday, August 12 onward')
    },
}

/** The destructive variant — RecurrenceDialog's delete-scope picker. The rose accent replaces
 *  the blue on the icon tile; `play` asserts the two actually render with different computed
 *  icon-tile colours rather than just carrying different class names. */
export const Danger: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', ...shell }}>
            <OptionRow
                icon="Calendar"
                label="All events"
                sublabel="The entire series"
                onClick={() => {}}
            />
            <OptionRow
                icon="Trash2"
                label="All events"
                sublabel="The entire series"
                danger
                onClick={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll('button')]
        expect(rows.length).toBe(2)
        expect(rows[0]!.className).not.toMatch(/danger/)
        expect(rows[1]!.className).toMatch(/danger/)
        const normalIc = rows[0]!.querySelector(
            '[class*="option-ic"]',
        ) as HTMLElement
        const dangerIc = rows[1]!.querySelector(
            '[class*="option-ic"]',
        ) as HTMLElement
        expect(getComputedStyle(dangerIc).color).not.toBe(
            getComputedStyle(normalIc).color,
        )
    },
}
