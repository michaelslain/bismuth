// Visual spec for <PaletteRow> — THE selectable result row (icon + label/detail + sublabel +
// shortcut). The plays below prove what a screenshot cannot: that no hover rule paints a background
// on any row while the SELECTED row keeps its accent wash, that the sublabel keeps its far-edge margin under ui/Text's `margin: 0`, and the
// listbox semantics.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import Kbd from './ascii/Kbd'
import PaletteRow, { Highlight } from './PaletteRow'

const meta = {
    title: 'UI/PaletteRow',
    component: PaletteRow,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PaletteRow>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (p: { children: any }) => (
    <div
        role="listbox"
        aria-label="rows"
        style={{ 'max-width': '360px', padding: '8px', background: 'var(--pop-bg-strong)' }}
    >
        {p.children}
    </div>
)

export const Basic: Story = {
    render: () => (
        <Frame>
            <PaletteRow icon="FileText" label="Housing" sublabel="notes" />
        </Frame>
    ),
}

export const Selected: Story = {
    render: () => (
        <Frame>
            <PaletteRow icon="FileText" label="Housing" sublabel="notes" selected />
        </Frame>
    ),
}

export const WithDetailAndShortcut: Story = {
    render: () => (
        <Frame>
            <PaletteRow
                icon="Sparkles"
                label="New note from template"
                detail="Creates a note prefilled from the selected template"
                shortcut={<Kbd combo="Mod+N" muted />}
            />
        </Frame>
    ),
}

export const HighlightedMatch: Story = {
    render: () => (
        <Frame>
            <PaletteRow
                icon="FileText"
                label={<Highlight text="Project Roadmap" indices={[0, 1, 8]} />}
                sublabel="projects"
            />
        </Frame>
    ),
}

/** Every rule that styles `:hover`, with `:hover` removed from its selector. A row the rule would
 *  paint under the pointer matches the stripped selector. Real `:hover` cannot be forced from a
 *  play (userEvent.hover dispatches events but never sets the pseudo-class), so the proof asks the
 *  cascade directly: would any hover rule that sets a background reach THIS row? */
function hoverRulesReaching(row: Element): string[] {
    const hits: string[] = []
    const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
            if ('cssRules' in rule && !(rule instanceof CSSStyleRule)) {
                walk((rule as CSSGroupingRule).cssRules)
                continue
            }
            if (!(rule instanceof CSSStyleRule)) continue
            if (!rule.selectorText.includes(':hover')) continue
            if (!rule.style.getPropertyValue('background')) continue
            const stripped = rule.selectorText.replaceAll(':hover', '')
            try {
                if (row.matches(stripped)) hits.push(rule.selectorText)
            } catch {
                /* a selector the engine will not parse cannot match */
            }
        }
    }
    for (const sheet of Array.from(document.styleSheets)) {
        try {
            walk(sheet.cssRules)
        } catch {
            /* cross-origin sheet */
        }
    }
    return hits
}

/** A clickable row never paints a background on hover (the standing decision, ui/ListRow.tsx), and
 *  here the pointer guard promotes the hovered row to `[data-selected]` anyway, so a hover fill
 *  would only flash before the selection caught up. The selected row keeps its accent wash.
 *  The detector is proved live first: a throwaway element with a real `:hover` background rule
 *  MUST be reported, otherwise an empty result for the rows would mean nothing. */
export const NoHoverFill: Story = {
    render: () => (
        <Frame>
            <PaletteRow icon="FileText" label="Housing" sublabel="notes" selected />
            <PaletteRow icon="FileText" label="Budget" sublabel="notes" />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const [selected, plain] = Array.from(
            canvasElement.querySelectorAll<HTMLElement>('[role="option"]'),
        )
        expect(selected.hasAttribute('data-selected')).toBe(true)
        expect(plain.hasAttribute('data-selected')).toBe(false)
        // Positive control: the detector sees a hover background rule when one exists.
        const style = document.createElement('style')
        style.textContent = '.hover-control:hover { background: red }'
        const control = document.createElement('div')
        control.className = 'hover-control'
        document.head.appendChild(style)
        document.body.appendChild(control)
        const controlHits = hoverRulesReaching(control)
        control.remove()
        style.remove()
        expect(controlHits.length).toBeGreaterThan(0)
        // No hover background rule reaches either row — selected or not.
        expect(hoverRulesReaching(plain)).toEqual([])
        expect(hoverRulesReaching(selected)).toEqual([])
        // And the selected row really carries the accent ink and a non-transparent wash.
        const probe = document.createElement('span')
        probe.style.color = 'var(--accent)'
        document.body.appendChild(probe)
        const accent = getComputedStyle(probe).color
        probe.remove()
        expect(getComputedStyle(selected).color).toBe(accent)
        expect(getComputedStyle(selected).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    },
}

/** Row inset is 8px, the detail line reads --text-muted (not --faint), and the sublabel keeps its
 *  far-edge placement even though ui/Label now composes ui/Text's `margin: 0`. */
export const GeometryAndContrast: Story = {
    render: () => (
        <Frame>
            <PaletteRow
                icon="Sparkles"
                label="New note from template"
                detail="Creates a note prefilled from the selected template"
                sublabel="templates"
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>('[role="option"]')!
        expect(getComputedStyle(row).paddingLeft).toBe('8px')
        expect(getComputedStyle(row).paddingRight).toBe('8px')
        const probe = document.createElement('span')
        probe.style.color = 'var(--text-muted)'
        document.body.appendChild(probe)
        const muted = getComputedStyle(probe).color
        probe.remove()
        const desc = [...row.querySelectorAll<HTMLElement>('span')].find(s =>
            s.textContent?.startsWith('Creates a note'),
        )!
        expect(getComputedStyle(desc).color).toBe(muted)
        const sub = [...row.querySelectorAll<HTMLElement>('span')].find(
            s => s.textContent === 'templates',
        )!
        // The sublabel sits at the row's far edge. (Its `margin-left: auto` resolves to 0 here —
        // `.palette-text` is flex: 1 and takes all the free space — so the edge is what is
        // asserted, not the margin.)
        const r = row.getBoundingClientRect()
        const sr = sub.getBoundingClientRect()
        expect(Math.round(r.right - 8 - sr.right)).toBeLessThanOrEqual(1)
    },
}

/** The listbox contract: `role="option"` rows inside a `role="listbox"`, `aria-selected` on every
 *  row, `data-selected` only on the cursor row. */
export const ListboxSemantics: Story = {
    render: () => (
        <Frame>
            <PaletteRow id="opt-0" label="Housing" selected />
            <PaletteRow id="opt-1" label="Budget" />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const list = canvasElement.querySelector('[role="listbox"]')!
        const opts = Array.from(list.querySelectorAll('[role="option"]'))
        expect(opts.map(o => o.getAttribute('aria-selected'))).toEqual(['true', 'false'])
        expect(opts.map(o => o.hasAttribute('data-selected'))).toEqual([true, false])
        expect(opts.map(o => o.id)).toEqual(['opt-0', 'opt-1'])
    },
}
