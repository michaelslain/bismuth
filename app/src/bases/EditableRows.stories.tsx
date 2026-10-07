// Visual spec for <EditableRows> — the one add / remove list every Bases field editor shares
// (conditions, formulas, sort keys, properties). The add row is the LAST row of the list, one row
// gap under the rows above it, and every remove button is spelled "Remove <noun>".
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import { createSignal, Index } from 'solid-js'
import EditableRows from './EditableRows'
import EditableRow from './EditableRow'
import { IconTextButton } from '../ui/IconTextButton'
import { TextInput } from '../ui/TextInput'

const meta = {
    title: 'Bases/EditableRows',
    component: EditableRows,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof EditableRows>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: { initial: string[]; empty?: string }) {
    const [items, setItems] = createSignal(p.initial)
    return (
        <div style={{ width: '460px' }}>
            <EditableRows
                isEmpty={items().length === 0}
                empty={p.empty}
                add={
                    <IconTextButton
                        icon="Plus"
                        onClick={() =>
                            setItems([...items(), `item ${items().length + 1}`])
                        }
                    >
                        add item
                    </IconTextButton>
                }
            >
                <Index each={items()}>
                    {(item, i) => (
                        <EditableRow
                            noun="item"
                            onRemove={() =>
                                setItems(items().filter((_, k) => k !== i))
                            }
                        >
                            <TextInput
                                value={item()}
                                aria-label="item"
                                onInput={v =>
                                    setItems(
                                        items().map((x, k) =>
                                            k === i ? v : x,
                                        ),
                                    )
                                }
                            />
                        </EditableRow>
                    )}
                </Index>
            </EditableRows>
        </div>
    )
}

/** Rows, then ONE add row directly beneath them in the same columns. */
export const Filled: Story = {
    render: () => <Harness initial={['one', 'two', 'three']} />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getAllByLabelText('Remove item')).toHaveLength(3)
        // the add row is the list's last row, one uniform gap under the last item
        const rows = c.getAllByTestId('list-row')
        const gaps = rows
            .slice(1)
            .map(
                (r, i) =>
                    r.getBoundingClientRect().top -
                    rows[i].getBoundingClientRect().bottom,
            )
        await expect(new Set(gaps.map(g => Math.round(g))).size).toBe(1)
        await expect(
            c.getAllByRole('button', { name: 'add item' }),
        ).toHaveLength(1)
    },
}

/** No rows: the hint stands in for them and the add row is still there. */
export const Empty: Story = {
    render: () => <Harness initial={[]} empty="no items yet." />,
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('no items yet.')).toBeInTheDocument()
        await userEvent.click(c.getByRole('button', { name: 'add item' }))
        await expect(c.queryByText('no items yet.')).not.toBeInTheDocument()
        await expect(c.getAllByLabelText('Remove item')).toHaveLength(1)
    },
}
