// Visual spec for <ChatSetup> — the dead-end screen ChatView.tsx swaps in for the transcript when
// a chat can't run: the active provider's CLI is missing, or this vault's hidden-notes policy can't
// be honoured. See ChatSetup.tsx for why one component covers all three copy variants.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChatSetup from './ChatSetup'

const meta = {
    title: 'Chat/ChatSetup',
    component: ChatSetup,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatSetup>

export default meta
type Story = StoryObj<typeof meta>

const frame = (children: unknown) => (
    <div style={{ height: '420px', display: 'flex' }}>{children as any}</div>
)

/** Claude Code's CLI isn't installed — the most common setup dead end. */
export const ClaudeMissing: Story = {
    render: () =>
        frame(
            <ChatSetup
                icon="MessageSquare"
                iconLabel="Chat"
                heading="Claude Code isn't available"
                body={
                    <p>
                        This chat runs the <code>claude</code> CLI on your
                        machine — it isn't installed or signed in. Install
                        Claude Code and sign in, then reopen this tab.
                    </p>
                }
                actionLabel="USE OPENCODE INSTEAD"
                onAction={() => {}}
            />,
        ),
}

/** opencode's CLI isn't installed. */
export const OpencodeMissing: Story = {
    render: () =>
        frame(
            <ChatSetup
                icon="MessageSquare"
                iconLabel="Chat"
                heading="opencode isn't available"
                body={
                    <p>
                        This chat is set to the opencode provider, but the{' '}
                        <code>opencode</code> CLI wasn't found on your
                        machine. Install it from opencode.ai (e.g.{' '}
                        <code>brew install sst/tap/opencode</code>), then
                        reopen this tab.
                    </p>
                }
                actionLabel="USE CLAUDE CODE INSTEAD"
                onAction={() => {}}
            />,
        ),
}

/** A visibility refusal — the backend IS installed, it just can't honour this vault's hidden
 *  notes. Distinct copy: never tells the user to install anything. */
export const VisibilityRefused: Story = {
    render: () =>
        frame(
            <ChatSetup
                icon="Lock"
                iconLabel="Visibility"
                heading="opencode can't honour this vault's hidden notes"
                body={
                    <p>
                        This vault hides some notes from AI tools, and
                        opencode has no verified mechanism to keep them out of
                        context. Switch to Claude Code, which does.
                    </p>
                }
                actionLabel="USE CLAUDE CODE INSTEAD"
                onAction={() => {}}
            />,
        ),
}
