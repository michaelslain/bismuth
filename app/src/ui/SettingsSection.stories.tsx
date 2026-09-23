// Visual spec for <SettingsSection> — `── name ─────` separating groups of fields in a settings
// form (was `.evm-modal .set-sect`; modal redesign Task 4, 2026-09-23 — Acceptance 6: a two-cell
// leading rule, lowercase faint name, trailing --rule-soft hairline to the edge).
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

/** A single rule, the hairline filling the remaining width. */
export const Standalone: Story = {
    render: () => (
        <div style={{ width: '400px' }}>
            <SettingsSection>general</SettingsSection>
        </div>
    ),
}

/** Two sections separating two grids of fields, the way a settings form composes them. */
export const SeparatingGrids: Story = {
    render: () => {
        const [title, setTitle] = createSignal('team sync')
        const [notes, setNotes] = createSignal('')
        const [interval, setInterval_] = createSignal('60')
        return (
            <div
                style={{
                    width: '460px',
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '14px',
                }}
            >
                <SettingsSection>event details</SettingsSection>
                <SettingsGrid>
                    <SettingsField label="title" badge="required">
                        <TextInput value={title()} onInput={setTitle} />
                    </SettingsField>
                    <SettingsField label="notes" badge="optional">
                        <TextInput value={notes()} onInput={setNotes} />
                    </SettingsField>
                </SettingsGrid>
                <SettingsSection>sync</SettingsSection>
                <SettingsGrid>
                    <SettingsField label="sync interval">
                        <TextInput value={interval()} onInput={setInterval_} />
                    </SettingsField>
                </SettingsGrid>
            </div>
        )
    },
}
