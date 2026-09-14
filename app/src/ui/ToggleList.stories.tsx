// Visual spec for <ToggleList> — the bordered, scrolling surface (max-height 320px) that groups
// a stack of ToggleRows (was `.evm-modal .set-cols`), e.g. BaseSettings' column-visibility list.
//
// Props: class, children.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { For, createSignal } from 'solid-js'
import ToggleList from './ToggleList'
import ToggleRow from './ToggleRow'

const meta = {
    title: 'UI/ToggleList',
    component: ToggleList,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ToggleList>

export default meta
type Story = StoryObj<typeof meta>

const COLUMNS = [
    'Title', 'Due', 'Priority', 'Tags', 'Created', 'Modified', 'Status',
    'Assignee', 'Project', 'Estimate', 'Reporter', 'Category', 'Effort', 'Notes',
]

/** A column-visibility list — more rows than fit before the 320px cap kicks in, so the list
 *  scrolls instead of growing the panel around it. `play` asserts the actual cap + scroll
 *  behavior rather than trusting the rule exists: a regression that drops `max-height` or the
 *  `overflow-y: auto` would let the panel grow unbounded, and this catches both. */
export const Default: Story = {
    render: () => {
        const [checked, setChecked] = createSignal<Record<string, boolean>>(
            Object.fromEntries(COLUMNS.map(c => [c, true])),
        )
        return (
            <div style={{ width: '260px' }}>
                <ToggleList>
                    <For each={COLUMNS}>
                        {col => (
                            <ToggleRow
                                label={col}
                                checked={checked()[col] ?? false}
                                onToggle={() =>
                                    setChecked(prev => ({
                                        ...prev,
                                        [col]: !prev[col],
                                    }))
                                }
                            />
                        )}
                    </For>
                </ToggleList>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const rows = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="toggle-row"]',
            ),
        ]
        expect(rows.length).toBe(COLUMNS.length)
        const list = rows[0]!.parentElement as HTMLElement
        const style = getComputedStyle(list)
        expect(style.maxHeight).toBe('320px')
        expect(style.overflowY).toBe('auto')
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    },
}
