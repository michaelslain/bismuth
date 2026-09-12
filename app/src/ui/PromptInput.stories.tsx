// Visual spec for <PromptInput> — the text input styled for <PromptModal> content
// (FolderPrompt's typed path, GcalConnectModal's Client ID / Secret fields). See
// PromptInput.module.css for how its chrome differs from ui/TextInput's `.ui-input`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import PromptInput from './PromptInput'

const meta = {
    title: 'UI/PromptInput',
    component: PromptInput,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof PromptInput>

export default meta
type Story = StoryObj<typeof meta>

/** Empty, with a placeholder — the FolderPrompt shape. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '320px' }}>
            <PromptInput placeholder="/Users/you/notes" value="" />
        </div>
    ),
}

/** Typed value, interactive. */
export const Interactive: Story = {
    render: () => {
        const [value, setValue] = createSignal('/Users/you/notes/inbox')
        return (
            <div style={{ width: '320px' }}>
                <PromptInput
                    value={value()}
                    onInput={e => setValue(e.currentTarget.value)}
                />
            </div>
        )
    },
}

/** type="password" — GcalConnectModal's Client Secret field. */
export const Password: Story = {
    render: () => (
        <div style={{ width: '320px' }}>
            <PromptInput
                type="password"
                placeholder="Client Secret"
                value=""
            />
        </div>
    ),
}
