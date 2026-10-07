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

/** Every CSSStyleRule in the live CSSOM whose selector matches `test`. CSS `:hover` and `:active`
 *  follow the REAL pointer; a story's `play` only dispatches synthetic events, so it cannot hold a
 *  row hovered or pressed. This proves the rule ships and names the right token; the state itself
 *  was exercised with a real pointer (see the task report). */
function rulesMatching(test: RegExp): CSSStyleRule[] {
    const out: CSSStyleRule[] = []
    const walk = (list: CSSRuleList) => {
        for (const r of Array.from(list)) {
            if (r instanceof CSSStyleRule && test.test(r.selectorText)) out.push(r)
            else if ('cssRules' in r) walk((r as CSSGroupingRule).cssRules)
        }
    }
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            walk(sheet.cssRules)
        } catch {
            /* a cross-origin sheet: not ours */
        }
    }
    return out
}

/** HOVER + PRESSED. Hover lifts the LABEL to the tone — `--accent` on the default row, `--danger` on
 *  the destructive one — so the two rows differ at the moment you are about to act, not only by the
 *  hue of a bare icon at rest; pressed is the one fill the row paints, `--state-active-bg`. Both
 *  are pointer states `play` cannot hold, so this asserts the shipped rules name the right tokens
 *  and that the two tones really differ. */
export const HoverAndPressed: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <OptionRow icon="Calendar" label="this event" sublabel="Aug 12, 2026" onClick={() => {}} />
                <OptionRow icon="Trash2" label="this event" sublabel="Aug 12, 2026" danger onClick={() => {}} />
            </RowList>
        </div>
    ),
    play: async () => {
        const hover = rulesMatching(/option-row.*:hover.*option-lab/)
        const tone = (danger: boolean) =>
            hover.find(r => /danger/.test(r.selectorText) === danger)?.style.color ?? ''
        expect(tone(false)).toContain('--accent')
        expect(tone(true)).toContain('--danger')
        const pressed = rulesMatching(/option-row[^ ]*:active/)
        expect(pressed.some(r => r.style.background.includes('--state-active-bg'))).toBe(true)
    },
}

/** The keyboard path. No focus ring — every button in the app paints no focus indicator, mouse or
 *  keyboard, by user decision (2026-09-27), so the frame of a focused row is identical to a resting
 *  one BY RULE. This story renders the DEFAULT row (it used to be a copy of the Danger row's
 *  markup, which made it a duplicate frame of `Danger`) and proves the keyboard path from state:
 *  a real Tab reaches the row, it matches `:focus-visible`, and it draws no outline.
 *
 *  `play` reaches the row with a real Tab rather than `.focus()`: a programmatic focus on a button
 *  does not satisfy `:focus-visible` in Chrome, so that would prove nothing about the keyboard. */
export const Focused: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <OptionRow
                    icon="CircleCheck"
                    label="this event"
                    sublabel="Aug 12, 2026"
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
