// Visual spec for <SettingsHint> — micro faint helper text under a settings field
// (was `.evm-modal .set-hint`). Usable standalone, so these stories show it both
// alone and trailing a field-shaped block.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import SettingsHint from './SettingsHint'

const meta = {
    title: 'UI/SettingsHint',
    component: SettingsHint,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof SettingsHint>

export default meta
type Story = StoryObj<typeof meta>

/** Standalone, the way it can be used outside of SettingsField. */
export const Standalone: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
            <SettingsHint>
                Changes take effect the next time the vault is opened.
            </SettingsHint>
        </div>
    ),
}

/** Trailing a label + control, the usual placement inside SettingsField. */
export const AfterAControl: Story = {
    render: () => (
        <div
            style={{
                width: '260px',
                display: 'flex',
                'flex-direction': 'column',
                gap: '4px',
            }}
        >
            <div>Sync interval</div>
            <div>60 seconds</div>
            <SettingsHint>
                How often the daemon polls for external changes.
            </SettingsHint>
        </div>
    ),
}
