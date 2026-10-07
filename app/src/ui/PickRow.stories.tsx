// Visual spec for <PickRow> — the `▸`-marker pick row: one choice out of a list, the current one
// marked. Replaces three hand-built copies (ChatModelPicker's connector + model rows,
// ChatPresetList's preset row). A fixed 2ch mark slot, a label that hangs under itself when it
// wraps, an optional faint right-aligned detail.
//
// Props: marked?, label (required), detail?, onPick?, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import { createSignal, For } from 'solid-js'
import PickRow from './PickRow'

const meta = {
    title: 'UI/PickRow',
    component: PickRow,
    parameters: { layout: 'padded' },
    args: { label: 'claude' },
} satisfies Meta<typeof PickRow>

export default meta
type Story = StoryObj<typeof meta>

const shell = { width: '240px' }

/** Marked and unmarked rows in one list — the `▸` slot is reserved on every row, so labels share one
 *  left edge. `play` proves it from geometry, not from the glyph. */
export const List: Story = {
    render: () => (
        <div style={shell}>
            <PickRow label="claude" marked />
            <PickRow label="codex" />
            <PickRow label="opencode" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="pick-row"]')]
        expect(rows.length).toBe(3)
        expect(rows[0]!.getAttribute('aria-current')).toBe('true')
        expect(rows[1]!.getAttribute('aria-current')).toBeNull()
        expect(rows[0]!.textContent).toContain('▸')
        expect(rows[1]!.textContent).not.toContain('▸')
        const lefts = rows.map(r => r.querySelector('span:nth-child(2)')!.getBoundingClientRect().left)
        expect(lefts[0]).toBe(lefts[1])
        expect(lefts[1]).toBe(lefts[2])
        // the marked row reads brighter than the rest at rest
        expect(getComputedStyle(rows[0]!).color).not.toBe(getComputedStyle(rows[1]!).color)
        for (const r of rows) expect(parseFloat(getComputedStyle(r).minHeight)).toBe(22)
    },
}

/** `detail`: a faint right-aligned badge — the model row's `free`. */
export const WithDetail: Story = {
    render: () => (
        <div style={shell}>
            <PickRow label="sonnet" detail="free" marked />
            <PickRow label="opus" detail="paid" />
            <PickRow label="haiku" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const d = canvasElement.querySelector('[data-testid="pick-row"] span:nth-child(3)') as HTMLElement
        expect(d.textContent).toBe('free')
        const row = d.parentElement!.getBoundingClientRect()
        expect(Math.abs(d.getBoundingClientRect().right - (row.right - 12))).toBeLessThan(1)
    },
}

/** A long label wraps and HANGS under the name, not under the `▸` — the hanging indent every copy
 *  hand-built with a negative `text-indent`. */
export const Wrapping: Story = {
    render: () => (
        <div style={{ width: '150px' }}>
            <PickRow label="a connector with a very long display name that must wrap" marked />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector('[data-testid="pick-row"]') as HTMLElement
        const label = row.querySelector('span:nth-child(2)') as HTMLElement
        expect(row.getBoundingClientRect().height).toBeGreaterThan(30)
        // every line of the label starts at the label's own left edge: the label is a grid column
        expect(label.getBoundingClientRect().left).toBeGreaterThan(
            row.querySelector('span')!.getBoundingClientRect().left + 5,
        )
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

/** Pressed: `--state-active-bg` while the pointer is down, and a hover that lifts the label to
 *  `--fg`. Pointer states `play` cannot hold, so this asserts the shipped rules name the tokens. */
export const PressedAndHover: Story = {
    render: () => (
        <div style={shell}>
            <PickRow label="claude" marked />
            <PickRow label="codex" />
        </div>
    ),
    play: async () => {
        const pressed = rulesMatching(/row[^ ]*:active/).filter(r => r.style.background.includes('--state-active-bg'))
        expect(pressed.length).toBeGreaterThan(0)
        const hover = rulesMatching(/row[^ ]*:hover/).filter(r => r.style.color.includes('--fg'))
        expect(hover.length).toBeGreaterThan(0)
    },
}

/** The real composition: click to pick; the mark follows the choice. */
export const Interactive: Story = {
    render: () => {
        const [cur, setCur] = createSignal('codex')
        return (
            <div style={shell}>
                <For each={['claude', 'codex', 'opencode']}>
                    {n => <PickRow label={n} marked={cur() === n} onPick={() => setCur(n)} />}
                </For>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const rows = () => [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="pick-row"]')]
        expect(rows()[1]!.getAttribute('aria-current')).toBe('true')
        await userEvent.click(rows()[2]!)
        expect(rows()[2]!.getAttribute('aria-current')).toBe('true')
        expect(rows()[1]!.getAttribute('aria-current')).toBeNull()
    },
}
