// Visual spec for <AsciiTree> — the vault file tree drawn with typed ASCII connectors
// ("|--" / "`--"), one surface glyph per row, hover wash, active-row accent.
//
// Props: rows (id, label, depth?, last?, glyph?, meta?), activeId?, onSelect?, class?.
// A row under a LAST folder draws a blank column, not a `|`; meta is right-aligned in its own
// slot; rows are one 18px row unit and reachable and selectable from the keyboard.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, fn, userEvent } from 'storybook/test'
import AsciiTree, { type AsciiTreeRow } from './AsciiTree'
import { Row } from '../_storyKit'

const meta = {
    title: 'UI/Ascii/AsciiTree',
    parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const vaultRows: AsciiTreeRow[] = [
    { id: 'journal', label: 'journal/', glyph: '▸' },
    { id: 'j15', label: '2029-09-15', glyph: '✎', depth: 1 },
    { id: 'j16', label: '2029-09-16', glyph: '✎', depth: 1, last: true },
    { id: 'reading', label: 'reading/', glyph: '▸' },
    { id: 'quotes', label: 'quotes/', glyph: '▸', depth: 1 },
    { id: 'q1', label: 'borges', glyph: '✎', depth: 2, last: true },
    {
        id: 'books',
        label: 'books',
        glyph: '▤',
        depth: 1,
        last: true,
        meta: '(12)',
    },
    { id: 'bismuth', label: 'bismuth.base', glyph: '▤', last: true },
]

/** A vault tree with an active row, hover wash, and click-to-select wired up. */
export const Vault: Story = {
    render: () => {
        const [active, setActive] = createSignal('j15')
        return (
            <Row label="Vault tree">
                <AsciiTree
                    rows={vaultRows}
                    activeId={active()}
                    onSelect={setActive}
                />
            </Row>
        )
    },
}

/** Depth 0–3 with alternating last/not-last, to eyeball the connector shapes. */
export const Depths: Story = {
    render: () => (
        <Row label="Depths 0-3">
            <AsciiTree
                rows={[
                    { id: 'd0', label: 'root', depth: 0 },
                    { id: 'd1', label: 'child', depth: 1 },
                    { id: 'd1l', label: 'last child', depth: 1, last: true },
                    { id: 'd2', label: 'grandchild', depth: 2 },
                    {
                        id: 'd2l',
                        label: 'last grandchild',
                        depth: 2,
                        last: true,
                    },
                    { id: 'd3', label: 'great-grandchild', depth: 3 },
                    {
                        id: 'd3l',
                        label: 'last great-grandchild',
                        depth: 3,
                        last: true,
                    },
                ]}
            />
        </Row>
    ),
}

/** Rows with right-aligned meta counts. */
export const WithMeta: Story = {
    render: () => (
        <Row label="With meta">
            <AsciiTree
                rows={[
                    { id: 'a', label: 'projects/', glyph: '▸', meta: '(5)' },
                    {
                        id: 'b',
                        label: 'archive/',
                        glyph: '▸',
                        depth: 1,
                        last: true,
                        meta: '(128)',
                    },
                ]}
            />
        </Row>
    ),
}

const rowEls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')]

/** A LAST folder with children: nothing runs under its `` `-- `` terminator. The children carry a
 *  blank column there, because a `|` implies siblings below the folder that do not exist. */
export const LastFolderWithChildren: Story = {
    render: () => (
        <Row label="Last folder with children">
            <AsciiTree
                rows={[
                    { id: 'a', label: 'notes/', glyph: '▸' },
                    { id: 'a1', label: 'one', glyph: '✎', depth: 1, last: true },
                    { id: 'z', label: 'archive/', glyph: '▸', last: true },
                    { id: 'z1', label: 'old', glyph: '✎', depth: 1 },
                    { id: 'z2', label: 'older/', glyph: '▸', depth: 1, last: true },
                    { id: 'z3', label: 'oldest', glyph: '✎', depth: 2, last: true },
                ]}
            />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const lines = rowEls(canvasElement).map(r => r.textContent ?? '')
        expect(lines.map(l => l.match(/^[|`\- ]*/)![0].trimEnd())).toEqual([
            '|--',
            '|   `--',
            '`--',
            '    |--',
            '    `--',
            '        `--',
        ])
        // no `|` in any column that a `-- terminator has already closed above it
        for (const l of lines.slice(3)) expect(l.slice(0, 4)).toBe('    ')
    },
}

/** Meta counts land in one right-aligned column whatever the prefix, glyph and label add up to
 *  (they used to land at col 28 and col 32). Rows are the 18px row unit. */
export const MetaColumn: Story = {
    render: () => (
        <Row label="Meta column">
            <AsciiTree
                rows={[
                    { id: 'a', label: 'projects/', glyph: '▸', meta: '(5)' },
                    { id: 'b', label: 'a rather longer folder name/', glyph: '▸', depth: 1, meta: '(1024)' },
                    { id: 'c', label: 'archive/', glyph: '▸', depth: 1, last: true, meta: '(128)' },
                    { id: 'd', label: 'no meta', glyph: '✎', last: true },
                ]}
            />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const rows = rowEls(canvasElement)
        const metas = rows.filter(r => r.childElementCount === 2).map(r => r.lastElementChild as HTMLElement)
        expect(metas.length).toBe(3)
        const right = metas.map(m => m.getBoundingClientRect().right)
        for (const x of right) expect(Math.abs(x - right[0]!), 'meta right edges share one x').toBeLessThan(0.5)
        // the slot sits at the row's trailing edge (inside its padding), not after the label
        const rowRight = rows[0]!.getBoundingClientRect().right
        expect(rowRight - right[0]!).toBeLessThan(parseFloat(getComputedStyle(rows[0]!).paddingRight) + 0.5)
        // one row unit tall, no vertical padding
        const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h'))
        for (const r of rows) expect(r.getBoundingClientRect().height).toBeCloseTo(rowH, 0)
    },
}

/** Keyboard: Tab reaches each row, Enter and Space select it. */
export const Keyboard: Story = {
    render: () => {
        const onSelect = fn()
        ;(window as unknown as { __treeSelect?: typeof onSelect }).__treeSelect = onSelect
        return (
            <Row label="Keyboard">
                <AsciiTree rows={vaultRows} onSelect={onSelect} />
            </Row>
        )
    },
    play: async ({ canvasElement }) => {
        const onSelect = (window as unknown as { __treeSelect: ReturnType<typeof fn> }).__treeSelect
        const rows = rowEls(canvasElement)
        await userEvent.tab()
        expect(document.activeElement).toBe(rows[0])
        await userEvent.tab()
        expect(document.activeElement).toBe(rows[1])
        await userEvent.keyboard('{Enter}')
        expect(onSelect).toHaveBeenLastCalledWith('j15')
        await userEvent.tab()
        await userEvent.keyboard('{ }')
        expect(onSelect).toHaveBeenLastCalledWith('j16')
    },
}
