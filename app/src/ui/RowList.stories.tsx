// Visual spec for <RowList> — THE list container for rows in a modal (DESIGN.md, Overlays: lists in
// a modal). No fill, no border, no rule between rows: rows sit on the modal ground, separated by
// their height, like the daemon crons list.
//
// Props: children, maxHeight?, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { For } from 'solid-js'
import RowList from './RowList'
import ListRow from './ListRow'
import Label from './Label'
import RemoveRowButton from './RemoveRowButton'

const meta = {
    title: 'UI/RowList',
    component: RowList,
    parameters: { layout: 'padded' },
    args: { children: null },
} satisfies Meta<typeof RowList>

export default meta
type Story = StoryObj<typeof meta>

const shell = { width: '380px' }
const NAMES = ['health', 'hygiene', 'career', 'education', 'knowledge']

const row = (name: string) => (
    <ListRow
        reveal
        trailing={<RemoveRowButton label={`Delete ${name}`} onClick={() => {}} />}
    >
        <Label fill>{name}</Label>
    </ListRow>
)

/** Five rows: no rule between them and no panel behind them. Hover a row for its `[x]`. */
export const Plain: Story = {
    render: () => (
        <div style={shell}>
            <RowList>
                <For each={NAMES}>{row}</For>
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const list = canvasElement.querySelector('[data-testid="row-list"]') as HTMLElement
        const rows = [...list.children] as HTMLElement[]
        expect(rows.length).toBe(NAMES.length)
        for (const r of rows) expect(parseFloat(getComputedStyle(r).borderTopWidth)).toBe(0)
        // the box-in-a-box this replaced: a filled, bordered panel inside the modal frame
        const cs = getComputedStyle(list)
        expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)')
        expect(parseFloat(cs.borderTopWidth)).toBe(0)
    },
}

/** One row. */
export const SingleRow: Story = {
    render: () => (
        <div style={shell}>
            <RowList>{row('health')}</RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const r = canvasElement.querySelector('[data-testid="list-row"]') as HTMLElement
        expect(parseFloat(getComputedStyle(r).borderTopWidth)).toBe(0)
    },
}

const MANY = [
    'title', 'due', 'priority', 'tags', 'created', 'modified', 'status',
    'assignee', 'project', 'estimate', 'reporter', 'category', 'effort', 'notes',
]

/** `maxHeight="var(--list-max-h)"` — the column-visibility list: past the cap the list scrolls
 *  instead of growing the dialog around it. */
export const Scrolling: Story = {
    render: () => (
        <div style={shell}>
            <RowList maxHeight="var(--list-max-h)">
                <For each={MANY}>{row}</For>
            </RowList>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const list = canvasElement.querySelector('[data-testid="row-list"]') as HTMLElement
        const cs = getComputedStyle(list)
        expect(cs.maxHeight).toBe('320px')
        expect(cs.overflowY).toBe('auto')
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
        // rows never squeeze: 14 rows at 24px each overflow the 320px cap and scroll, instead of
        // shrinking toward ~23px apiece until the list fits and never scrolls
        const rows = [...list.children] as HTMLElement[]
        for (const r of rows) expect(r.getBoundingClientRect().height).toBeGreaterThanOrEqual(24)
        expect(list.scrollHeight).toBeGreaterThanOrEqual(rows.length * 24)
    },
}
