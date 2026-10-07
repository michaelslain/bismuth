// Visual spec for <FormulasEditor> — a base's `formulas:` as name / expression rows. Duplicate
// names and unparsable expressions are flagged under the row.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal } from 'solid-js'
import FormulasEditor from './FormulasEditor'
import type { FormulaRow } from './formulasForm'

const meta = {
    title: 'Bases/FormulasEditor',
    component: FormulasEditor,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof FormulasEditor>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: { initial: FormulaRow[] }) {
    const [rows, setRows] = createSignal(p.initial)
    return (
        <div style={{ width: '560px' }}>
            <FormulasEditor rows={rows()} onChange={setRows} />
        </div>
    )
}

export const Empty: Story = { render: () => <Harness initial={[]} /> }

export const TwoFormulas: Story = {
    render: () => (
        <Harness
            initial={[
                { name: 'ppu', expr: 'price / pages' },
                { name: 'overdue', expr: 'date(due) < today() && !done' },
            ]}
        />
    ),
}

/** A repeated name and an expression the parser rejects, each flagged in place. */
export const Problems: Story = {
    render: () => (
        <Harness
            initial={[
                { name: 'total', expr: 'price * qty' },
                { name: 'total', expr: 'price *' },
            ]}
        />
    ),
}

/** Typing into a name keeps focus (rows are keyed by position, not by object). */
export const RenameKeepsFocus: Story = {
    render: () => (
        <Harness initial={[{ name: 'ppu', expr: 'price / pages' }]} />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        const name = (await c.findByDisplayValue('ppu')) as HTMLInputElement
        await userEvent.clear(name)
        await userEvent.type(name, 'per page')
        await expect(document.activeElement).toBe(name)
        await expect(name.value).toBe('per page')
    },
}

/** Add appends a uniquely named empty row; delete removes exactly the row asked. */
export const AddAndDelete: Story = {
    render: () => (
        <Harness initial={[{ name: 'ppu', expr: 'price / pages' }]} />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByText('add formula'))
        await expect(await c.findByDisplayValue('formula')).toBeInTheDocument()
        await userEvent.click(c.getByText('add formula'))
        await expect(await c.findByDisplayValue('formula 2')).toBeInTheDocument()
        await userEvent.click(c.getAllByLabelText('Remove formula')[0])
        await expect(c.queryByDisplayValue('ppu')).not.toBeInTheDocument()
        await expect(c.getAllByLabelText('Remove formula')).toHaveLength(2)
    },
}
