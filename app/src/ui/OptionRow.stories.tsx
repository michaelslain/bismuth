// Visual spec for <OptionRow> — the large single-choice row (icon mark + label + sublabel +
// chevron) RecurrenceDialog used to hand-roll as a bare `.rec-opt` button. See OptionRow.tsx's
// header comment for why this needed its own primitive rather than reusing TextButton/Button.
//
// EVERY STORY WRAPS THE ROWS IN <OptionList>, because that is the only way they ship. The row is
// transparent and draws a hairline against its previous sibling; on a bare background it is
// therefore a row with no panel, which is not a state the app ever renders and would quietly become
// the thing people design against.
//
// Props: icon (registry name, required), label (required), sublabel (optional), danger
// (destructive tone), onClick (required), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { OptionRow } from './OptionRow'
import OptionList from './OptionList'

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
            <OptionList>
                <OptionRow
                    icon="CircleCheck"
                    label="This event"
                    onClick={() => {}}
                />
            </OptionList>
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
        expect(canvasElement.querySelectorAll('svg').length).toBe(2) // mark + chevron
        // The panel owns the surface now, not the row. A row that paints its own background is the
        // regression that made three choices read as three stacked cards.
        expect(getComputedStyle(row).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    },
}

/** Icon + label + sublabel — RecurrenceDialog's actual shape ("This and following events" /
 *  "This and following events onward"). */
export const Sublabel: Story = {
    render: () => (
        <div style={shell}>
            <OptionList>
                <OptionRow
                    icon="ArrowRight"
                    label="This and following events"
                    sublabel="Tuesday, August 12 onward"
                    onClick={() => {}}
                />
            </OptionList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const sub = canvasElement.querySelector('[class*="option-sub"]')
        expect(sub).not.toBeNull()
        expect(sub!.textContent).toBe('Tuesday, August 12 onward')
    },
}

/** The destructive variant — RecurrenceDialog's delete-scope picker. `--danger` replaces the
 *  accent on the bare mark; `play` asserts the two render with different computed mark colours
 *  rather than just carrying different class names, AND that neither mark sits on a filled plate.
 *  The plate is the specific thing that made three stacked delete choices read as three pink
 *  buttons, so a regression that reinstates a background here is worth failing on. */
export const Danger: Story = {
    render: () => (
        <div style={shell}>
            <OptionList>
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
            </OptionList>
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
        for (const ic of [normalIc, dangerIc]) {
            expect(getComputedStyle(ic).backgroundColor).toBe('rgba(0, 0, 0, 0)')
        }
        // The separator is a hairline between rows, not a box around each: the FIRST row must carry
        // no top border, the second must. A rule that regressed to `border: 1px solid` on the row
        // would still look plausible in a screenshot and would fail here.
        expect(parseFloat(getComputedStyle(rows[0]!).borderTopWidth)).toBe(0)
        expect(
            parseFloat(getComputedStyle(rows[1]!).borderTopWidth),
        ).toBeGreaterThan(0)
    },
}

/** The keyboard path. There was no focus ring at all before this: tabbing the delete dialog gave
 *  no indication of which irreversible scope was about to be committed.
 *
 *  `play` reaches the row with a real Tab rather than `.focus()`. That is not fussiness — a
 *  programmatic focus on a button does not satisfy `:focus-visible` in Chrome, so the ring would
 *  compute to `none` and the story would fail against correct CSS. */
export const Focused: Story = {
    render: () => (
        <div style={shell}>
            <OptionList>
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
        const row = canvasElement.querySelector('button') as HTMLElement
        await userEvent.tab()
        expect(document.activeElement).toBe(row)
        expect(row.matches(':focus-visible')).toBe(true)
        const cs = getComputedStyle(row)
        expect(cs.outlineStyle).not.toBe('none')
        expect(parseFloat(cs.outlineWidth)).toBeGreaterThan(0)
        // Drawn INSIDE the row, so OptionList's `overflow: hidden` cannot clip it away.
        expect(parseFloat(cs.outlineOffset)).toBeLessThan(0)
    },
}
