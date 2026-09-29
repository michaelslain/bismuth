// Visual spec for <ListRow> — one modal-list row: leading / main / trailing, 22px (`--row-h` +
// `--sp-1` either side), `--fs-ui` regular — the daemon crons row's measurements. Shown inside a RowList, because that is the only way it ships.
//
// Props: leading?, children, trailing?, reveal?, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
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

/** `reveal` — the trailing `[x]` is hidden until the row is hovered or holds focus. `play`
 *  proves it is hidden at rest (opacity, so its column keeps its width). */
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
        const x = canvasElement.querySelector('[aria-label="Delete career"]') as HTMLElement
        expect(getComputedStyle(x.parentElement!).opacity).toBe('0')
        expect(x.getBoundingClientRect().width).toBeGreaterThan(0)
    },
}
