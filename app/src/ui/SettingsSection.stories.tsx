// Visual spec for <SettingsSection> — the uppercase section eyebrow with a
// trailing hairline that separates groups of fields in a settings form (was
// `.evm-modal .set-sect`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import SettingsSection from './SettingsSection'
import SettingsGrid from './SettingsGrid'
import SettingsField from './SettingsField'
import { TextInput } from './TextInput'
import { createSignal } from 'solid-js'

const meta = {
    title: 'UI/SettingsSection',
    component: SettingsSection,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsSection>

export default meta
type Story = StoryObj<typeof meta>

/** A single eyebrow, the hairline filling the remaining width. */
export const Standalone: Story = {
    render: () => (
        <div style={{ width: '400px' }}>
            <SettingsSection>General</SettingsSection>
        </div>
    ),
}

/** Two sections separating two grids of fields, the way a settings form composes them. */
export const SeparatingGrids: Story = {
    render: () => {
        const [title, setTitle] = createSignal('Team sync')
        const [notes, setNotes] = createSignal('')
        return (
            <div
                style={{
                    width: '548px',
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '14px',
                }}
            >
                <SettingsSection>Event details</SettingsSection>
                <SettingsGrid>
                    <SettingsField label="Title" badge="required">
                        <TextInput value={title()} onInput={setTitle} />
                    </SettingsField>
                    <SettingsField label="Notes" badge="optional">
                        <TextInput value={notes()} onInput={setNotes} />
                    </SettingsField>
                </SettingsGrid>
                <SettingsSection>Sync</SettingsSection>
            </div>
        )
    },
}
