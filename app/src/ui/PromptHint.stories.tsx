// Visual spec for <PromptHint> — the muted info/status paragraph used inside <PromptModal>,
// anywhere from once to several times per call site (a description, a loading message, a
// connection status, a warning list), frequently behind a <Show>.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import PromptHint from './PromptHint'

const meta = {
    title: 'UI/PromptHint',
    component: PromptHint,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof PromptHint>

export default meta
type Story = StoryObj<typeof meta>

/** A plain sentence — the common case. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '360px' }}>
            <PromptHint>
                absolute path to a folder. it opens as its own brain in a new
                window.
            </PromptHint>
        </div>
    ),
}

/** Wrapping arbitrary nested markup instead of plain text — the
 *  BismuthInstallModal/DaemonSetupModal status-block shape. */
export const WrappingNestedRows: Story = {
    render: () => (
        <div style={{ width: '360px' }}>
            <PromptHint>
                <div>CLI on PATH: yes (/usr/local/bin/bismuth)</div>
                <div>MCP registered: yes</div>
                <div>Version: 1.4.2</div>
            </PromptHint>
        </div>
    ),
}
