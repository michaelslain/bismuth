// Visual spec for <ListRow> — one modal-list row: leading / main / trailing, 22px (`--row-h` +
// `--sp-1` either side), `--fs-ui` regular — the daemon crons row's measurements. Shown inside a RowList, because that is the only way it ships.
//
// Props: leading?, children, trailing?, reveal?, pressed?, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { createSignal } from 'solid-js'
import ListRow from './ListRow'
import RowList from './RowList'
import Label from './Label'
import ColorChip from './ColorChip'
import StatusDot from './StatusDot'
import { resolvePaletteColor } from './palette'
import RemoveRowButton from './RemoveRowButton'

const meta = {
    title: 'UI/ListRow',
    component: ListRow,
    parameters: { layout: 'padded' },
    args: { children: null },
} satisfies Meta<typeof ListRow>

export default meta
type Story = StoryObj<typeof meta>

const shell = { width: '380px' }

function Chip(props: { color: string }) {
    const [open, setOpen] = createSignal(false)
    const [color, setColor] = createSignal(props.color)
    return (
        <ColorChip
            color={color()}
            trigger={<StatusDot size="md" color={resolvePaletteColor(color())} />}
            open={open()}
            onToggle={() => setOpen(o => !o)}
            onPick={c => {
                setColor(c)
                setOpen(false)
            }}
        />
    )
}

/** All three slots — the category row's shape. The trailing `[x]` is `--faint` at rest. */
export const Slots: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <ListRow
                    leading={<Chip color="green" />}
                    trailing={<RemoveRowButton label="Delete health" onClick={() => {}} />}
                >
                    <Label fill>health</Label>
                </ListRow>
                <ListRow
                    leading={<Chip color="teal" />}
                    trailing={<RemoveRowButton label="Delete hygiene" onClick={() => {}} />}
                >
                    <Label fill>hygiene</Label>
                </ListRow>
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [
            ...canvasElement.querySelectorAll<HTMLElement>('[data-testid="list-row"]'),
        ]
        expect(rows.length).toBe(2)
        for (const r of rows) {
            const cs = getComputedStyle(r)
            expect(cs.minHeight).toBe('22px')
            expect(cs.fontSize).toBe('11.5px')
            expect(cs.fontWeight).toBe('400')
        }
        // the remove mark is quiet at rest: not the danger hue
        const x = canvasElement.querySelector('[aria-label="Delete health"]') as HTMLElement
        // resolve --danger to the same rgb() form getComputedStyle reports, or the check is vacuous
        const probe = document.createElement('i')
        probe.style.color = 'var(--danger)'
        canvasElement.appendChild(probe)
        const danger = getComputedStyle(probe).color
        probe.remove()
        expect(getComputedStyle(x).color).not.toBe(danger)
        // leading chips share one x, so the names start on one column
        const chips = rows.map(r => r.firstElementChild!.getBoundingClientRect().left)
        expect(chips[0]).toBe(chips[1])
    },
}

/** Main slot only. */
export const MainOnly: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <ListRow>
                    <Label fill>a row with nothing either side</Label>
                </ListRow>
            </RowList>
        </div>
    ),
}

/** `reveal` — the trailing `[x]` is hidden until the row is hovered or the `[x]` holds focus. A frame
 *  of the resting state proves nothing (that is the defect on touch), so `play` drives the keyboard
 *  path: hidden at rest (opacity, so its column keeps its width), shown while the `[x]` is focused,
 *  hidden again on blur. It ends with the first `[x]` focused, so the frame shows a revealed `[x]`
 *  beside a hidden one. Hover cannot be held from `play` (`:hover` follows the real pointer); the
 *  hover path was exercised with a real pointer — see the task report. */
export const Reveal: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <ListRow reveal trailing={<RemoveRowButton label="Delete career" onClick={() => {}} />}>
                    <Label fill>career</Label>
                </ListRow>
                <ListRow reveal trailing={<RemoveRowButton label="Delete care" onClick={() => {}} />}>
                    <Label fill>care</Label>
                </ListRow>
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const x = (label: string) => canvasElement.querySelector(`[aria-label="${label}"]`) as HTMLElement
        const a = x('Delete career').parentElement!
        const b = x('Delete care').parentElement!
        expect(getComputedStyle(a).opacity).toBe('0')
        expect(getComputedStyle(b).opacity).toBe('0')
        expect(a.getBoundingClientRect().width).toBeGreaterThan(0)
        x('Delete care').focus()
        await waitFor(() => expect(getComputedStyle(b).opacity).toBe('1'))
        expect(getComputedStyle(a).opacity).toBe('0')
        x('Delete care').blur()
        await waitFor(() => expect(getComputedStyle(b).opacity).toBe('0'))
        x('Delete career').focus()
        await waitFor(() => expect(getComputedStyle(a).opacity).toBe('1'))
    },
}

/** `reveal` on TOUCH. There is no hover on an iPad, so a `[x]` resting at `opacity: 0` is
 *  unreachable (bases/TaskRow had exactly this defect). The shipped stylesheet must carry a
 *  `@media (hover: none)` rule that forces the trailing slot to `opacity: 1` — `play` finds that rule
 *  in the live CSSOM. (A story frame cannot emulate `hover: none`; the media query itself was
 *  exercised once under touch emulation, recorded in the task report.) */
export const RevealOnTouch: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <ListRow reveal trailing={<RemoveRowButton label="Delete career" onClick={() => {}} />}>
                    <Label fill>career</Label>
                </ListRow>
            </RowList>
        </div>
    ),
    play: async () => {
        const rules: CSSStyleRule[] = []
        const walk = (list: CSSRuleList, inNoHover: boolean) => {
            for (const r of Array.from(list)) {
                if (r instanceof CSSMediaRule) {
                    walk(r.cssRules, inNoHover || r.conditionText.replace(/\s/g, '') === '(hover:none)')
                } else if (inNoHover && r instanceof CSSStyleRule) rules.push(r)
            }
        }
        for (const sheet of Array.from(document.styleSheets)) {
            try {
                walk(sheet.cssRules, false)
            } catch {
                /* a cross-origin sheet: not ours */
            }
        }
        const hit = rules.find(
            r => /reveal/.test(r.selectorText) && /trailing/.test(r.selectorText) && r.style.opacity === '1',
        )
        expect(hit).toBeDefined()
    },
}

/** `pressed` — the row paints `--state-active-bg`, the one pressed fill. `play` resolves the token
 *  through a probe (the same rgb() form getComputedStyle reports) so the check cannot pass on a
 *  transparent row, and proves the unpressed row beside it stays unfilled. */
export const Pressed: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <ListRow pressed>
                    <Label fill>pressed row</Label>
                </ListRow>
                <ListRow>
                    <Label fill>resting row</Label>
                </ListRow>
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = [...canvasElement.querySelectorAll<HTMLElement>('[data-testid="list-row"]')]
        const probe = document.createElement('i')
        probe.style.background = 'var(--state-active-bg)'
        canvasElement.appendChild(probe)
        const want = getComputedStyle(probe).backgroundColor
        probe.remove()
        expect(want).not.toBe('rgba(0, 0, 0, 0)')
        expect(getComputedStyle(rows[0]!).backgroundColor).toBe(want)
        expect(getComputedStyle(rows[1]!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    },
}
