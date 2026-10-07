// Visual spec for <EditableRow> — one row of an EditableRows list: a label cell on the form's
// label column, the controls, extra actions, the remove button ("Remove <noun>") and a note under
// the row.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import EditableRow from './EditableRow'
import { IconButton } from '../ui/IconButton'
import { TextInput } from '../ui/TextInput'
import SettingsHint from '../ui/SettingsHint'

const meta = {
    title: 'Bases/EditableRow',
    component: EditableRow,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof EditableRow>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Just controls and the remove button, named from the noun. */
export const Plain: Story = {
    render: () => (
        <div style={{ width: '460px' }}>
            <EditableRow noun="formula" onRemove={noop}>
                <TextInput
                    value="price * qty"
                    aria-label="expression"
                    onInput={noop}
                />
            </EditableRow>
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByRole('button', {
                name: 'Remove formula',
            }),
        ).toBeInTheDocument()
    },
}

/** A label cell, extra actions before remove, and a note under the row. */
export const LabelledWithActionsAndHint: Story = {
    render: () => (
        <div style={{ width: '460px' }}>
            <EditableRow
                noun="sort key"
                label="then by"
                onRemove={noop}
                actions={
                    <>
                        <IconButton
                            icon="ArrowUp"
                            label="Move up"
                            onClick={noop}
                        />
                        <IconButton
                            icon="ArrowDown"
                            label="Move down"
                            onClick={noop}
                        />
                    </>
                }
                hint={<SettingsHint>a note about this row</SettingsHint>}
            >
                <TextInput
                    value="priority"
                    aria-label="property"
                    onInput={noop}
                />
            </EditableRow>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('then by')).toBeInTheDocument()
        await expect(c.getByText('a note about this row')).toBeInTheDocument()
        await expect(
            c.getByRole('button', { name: 'Remove sort key' }),
        ).toBeInTheDocument()
    },
}
