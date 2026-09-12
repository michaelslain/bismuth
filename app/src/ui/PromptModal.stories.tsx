// Visual spec for <PromptModal> — the small typed-input / status-and-action modal body shared
// by FolderPrompt, DaemonOwnerModal, GcalConnectModal, BismuthInstallModal and DaemonSetupModal.
// Named slots (title, actions, children) rather than positional children — see PromptModal.tsx.
// Wraps its own <Modal>, so the story just needs a fullscreen canvas for the backdrop to fill.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import PromptModal from './PromptModal'
import PromptHint from './PromptHint'
import PromptInput from './PromptInput'
import { TextButton } from './TextButton'

const meta = {
    title: 'UI/PromptModal',
    component: PromptModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PromptModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** One hint + one input + two actions — the FolderPrompt shape. */
export const Default: Story = {
    render: () => (
        <PromptModal
            onClose={noop}
            title="Open folder"
            actions={
                <>
                    <TextButton onClick={noop}>CANCEL</TextButton>
                    <TextButton variant="selected" onClick={noop}>
                        OPEN
                    </TextButton>
                </>
            }
        >
            <PromptHint>
                Absolute path to a folder. It opens as its own brain in a new
                window.
            </PromptHint>
            <PromptInput placeholder="/Users/you/notes" value="" />
        </PromptModal>
    ),
}

/** Several hints and three actions — the DaemonSetupModal shape (a description, a busy
 *  message, and a status block, none of them an input). */
export const MultipleHintsNoInput: Story = {
    render: () => (
        <PromptModal
            onClose={noop}
            title="Set up daemon"
            actions={
                <>
                    <TextButton onClick={noop}>CLOSE</TextButton>
                    <TextButton onClick={noop}>UPDATE</TextButton>
                    <TextButton variant="selected" onClick={noop}>
                        SET UP / REPAIR
                    </TextButton>
                </>
            }
        >
            <PromptHint>
                The daemon runs crons and the persistent bot session in the
                background.
            </PromptHint>
            <PromptHint>
                <div>Installed: yes</div>
                <div>Running: yes</div>
                <div>Owner: this device</div>
            </PromptHint>
        </PromptModal>
    ),
}
