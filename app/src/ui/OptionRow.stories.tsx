// Visual spec for <OptionRow> — the large single-choice row (icon mark + label + sublabel +
// chevron) RecurrenceDialog used to hand-roll as a bare `.rec-opt` button. See OptionRow.tsx's
// header comment for why this needed its own primitive rather than reusing TextButton/Button.
//
// EVERY STORY WRAPS THE ROWS IN <RowList>, because that is the only way they ship: RowList draws the
// hairline between rows, so a row shown alone would hide the seam people design against. Labels are
// lowercase, as RecurrenceDialog passes them.
//
// Props: icon (registry name, required), label (required), sublabel (optional), danger
// (destructive tone), onClick (required), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { OptionRow } from './OptionRow'
import RowList from './RowList'

const meta = {
    title: 'UI/OptionRow',
    component: OptionRow,
    parameters: { layout: 'padded' },
    args: {
        icon: 'CircleCheck',
        label: 'this event',
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
            <RowList>
                <OptionRow
                    icon="CircleCheck"
                    label="this event"
                    onClick={() => {}}
                />
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('button') as HTMLElement
        expect(row).not.toBeNull()
        expect(row.className).not.toMatch(/danger/)
        expect(
            canvasElement.querySelector('[class*="option-lab"]')!.textContent,
        ).toBe('this event')
        expect(canvasElement.querySelector('[class*="option-sub"]')).toBeNull()
        expect(canvasElement.querySelectorAll('svg').length).toBe(1) // the mark; no chevron
        // The panel owns the surface now, not the row. A row that paints its own background is the
        // regression that made three choices read as three stacked cards.
        expect(getComputedStyle(row).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    },
}

/** Icon + label + sublabel — RecurrenceDialog's actual shape ("this and following events" /
 *  "This and following events onward"). */
export const Sublabel: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <OptionRow
                    icon="ArrowRight"
                    label="this and following events"
                    sublabel="Aug 12, 2026 onward"
                    onClick={() => {}}
                />
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const sub = canvasElement.querySelector('[class*="option-sub"]')
        expect(sub).not.toBeNull()
        expect(sub!.textContent).toBe('Aug 12, 2026 onward')
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
            <RowList>
                <OptionRow
                    icon="Calendar"
                    label="all events"
                    sublabel="the entire series"
                    onClick={() => {}}
                />
                <OptionRow
                    icon="Trash2"
                    label="all events"
                    sublabel="the entire series"
                    danger
                    onClick={() => {}}
                />
            </RowList>
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
        // No rule between rows and no box around each — rows are separated by their height, like
        // the daemon crons list. A border creeping back onto the row fails here.
        for (const r of rows) expect(parseFloat(getComputedStyle(r).borderTopWidth)).toBe(0)
    },
}

/** The keyboard path. No focus ring — every button in the app paints no focus indicator, mouse or
 *  keyboard, by user decision (2026-09-27): OptionRow is a bare `<button>` and gets the same
 *  treatment as every other button family member, even though a keyboard user tabbing the delete
 *  dialog loses the visual cue for which irreversible scope is about to be committed.
 *
 *  `play` reaches the row with a real Tab rather than `.focus()`. That is not fussiness — a
 *  programmatic focus on a button does not satisfy `:focus-visible` in Chrome, so this would prove
 *  nothing about the keyboard path specifically. */
export const Focused: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <OptionRow
                    icon="Calendar"
                    label="all events"
                    sublabel="the entire series"
                    danger
                    onClick={() => {}}
                />
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('button') as HTMLElement
        await userEvent.tab()
        expect(document.activeElement).toBe(row)
        expect(row.matches(':focus-visible')).toBe(true)
        const cs = getComputedStyle(row)
        expect(cs.outlineStyle).toBe('none')
    },
}
