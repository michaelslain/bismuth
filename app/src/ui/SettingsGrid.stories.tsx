// Visual spec for <SettingsGrid> — two equal columns holding SettingsField
// children (was `.evm-modal .set-grid`). SettingsGrid owns only the column
// layout; it defers entirely to whatever fields are passed in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import SettingsGrid from './SettingsGrid'
import SettingsField from './SettingsField'
import { TextInput } from './TextInput'

const meta = {
    title: 'UI/SettingsGrid',
    component: SettingsGrid,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsGrid>

export default meta
type Story = StoryObj<typeof meta>

/** Two fields side by side, the grid's ordinary shape. */
export const TwoFields: Story = {
    render: () => {
        const [title, setTitle] = createSignal('Team sync')
        const [category, setCategory] = createSignal('Work')
        return (
            <div style={{ width: '548px' }}>
                <SettingsGrid>
                    <SettingsField label="Title" badge="required">
                        <TextInput value={title()} onInput={setTitle} />
                    </SettingsField>
                    <SettingsField label="Category" badge="optional">
                        <TextInput value={category()} onInput={setCategory} />
                    </SettingsField>
                </SettingsGrid>
            </div>
        )
    },
}

/** A `span` field takes the full width of the grid, the remaining two split the row below it. */
export const WithSpanningField: Story = {
    render: () => {
        const [title, setTitle] = createSignal('Team sync')
        const [start, setStart] = createSignal('09:00')
        const [end, setEnd] = createSignal('09:30')
        return (
            <div style={{ width: '548px' }}>
                <SettingsGrid>
                    <SettingsField label="Title" badge="required" span>
                        <TextInput value={title()} onInput={setTitle} />
                    </SettingsField>
                    <SettingsField label="Start" badge="required">
                        <TextInput value={start()} onInput={setStart} />
                    </SettingsField>
                    <SettingsField label="End" badge="required">
                        <TextInput value={end()} onInput={setEnd} />
                    </SettingsField>
                </SettingsGrid>
            </div>
        )
    },
}
