// Visual spec for <FiltersEditor> — the no-code editor for a base's / view's `filters:` and a
// source's `where:`. Condition rows (property / operator / value) joined by one "match all / any"
// switch; anything the pickers can't model (a nested `or:`, a `not:`, a leaf that would not
// round-trip exactly) is a raw expression row that saves back verbatim (filterForm.ts).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import FiltersEditor from './FiltersEditor'
import { filterToForm, formToFilter } from './filterForm'
import { SAMPLE_ROWS } from '../ui/_baseFixtures'
import type { FilterNode } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/FiltersEditor',
    component: FiltersEditor,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof FiltersEditor>

export default meta
type Story = StoryObj<typeof meta>

const PROPS = ['file.name', 'status', 'priority', 'done', 'due', 'tags']

function Harness(p: { initial?: FilterNode }) {
    const [form, setForm] = createSignal(filterToForm(p.initial))
    return (
        <div style={{ width: '560px' }}>
            <FiltersEditor
                value={form()}
                onChange={setForm}
                properties={PROPS}
                rows={SAMPLE_ROWS}
                emptyHint="no conditions — every row is kept."
            />
            <pre data-testid="filters-out">
                {JSON.stringify(formToFilter(form()) ?? null)}
            </pre>
        </div>
    )
}

/** No filter yet: just the empty hint and the two add buttons. */
export const Empty: Story = { render: () => <Harness /> }

/** An `and:` tree of visual conditions — the "match all / any" line appears at two rows. */
export const Conditions: Story = {
    render: () => (
        <Harness
            initial={{
                and: [
                    'status == "Todo"',
                    'priority > 1',
                    'file.hasTag("planning")',
                    'date(due) < today()',
                ],
            }}
        />
    ),
}

/** A tree deeper than one and/or list: the nested `or:` and the `not:` show as expression rows
 *  and are written back as the SAME subtrees when another row is edited. */
export const NestedTreeKept: Story = {
    render: () => (
        <Harness
            initial={{
                and: [
                    'status == "Todo"',
                    { or: ['priority > 2', 'done'] },
                    { not: ['file.hasTag("archive")'] },
                ],
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const value = (await c.findByDisplayValue('Todo')) as HTMLInputElement
        await userEvent.clear(value)
        await userEvent.type(value, 'Doing')
        const out = JSON.parse(c.getByTestId('filters-out').textContent!)
        await expect(out).toEqual({
            and: [
                'status == "Doing"',
                { or: ['priority > 2', 'done'] },
                { not: ['file.hasTag("archive")'] },
            ],
        })
    },
}

/** A single malformed / legacy expression is kept as one raw row, never dropped. */
export const RawExpression: Story = {
    render: () => <Harness initial="done == true || this is not valid )(" />,
}
