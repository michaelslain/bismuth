// Visual spec for <ChatSetupGate> — the shared "this chat can't run" dead end, extracted out of
// ChatView.tsx and DaemonChat.tsx so both compose ONE copy of the install/refusal messaging (final
// review finding: the daemon copy had lost the install instructions and used bare `<p>`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ChatSetupGate from './ChatSetupGate'
import { makeStubChatSession } from './_stubChatSession'
import Text from '../ui/Text'

const meta = {
    title: 'Chat/ChatSetupGate',
    component: ChatSetupGate,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatSetupGate>

export default meta
type Story = StoryObj<typeof meta>

function Frame(props: { children: unknown }) {
    return (
        <div style={{ height: '420px', width: '520px', display: 'flex' }}>
            {props.children as never}
        </div>
    )
}

const Children = () => <Text>chat content — hidden while a dead end shows</Text>

/** Nothing wrong: `children` renders straight through. */
export const Passthrough: Story = {
    render: () => (
        <Frame>
            <ChatSetupGate session={makeStubChatSession()}>
                <Children />
            </ChatSetupGate>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.textContent?.includes('chat content'),
        ).toBe(true)
    },
}

/** The vault's hidden-notes policy can't be honoured by the active backend — a distinct dead end
 *  from the missing-CLI ones below, with its own copy and no install instructions. */
export const VisibilityRefusal: Story = {
    render: () => (
        <Frame>
            <ChatSetupGate
                session={makeStubChatSession({
                    gateRefusal: {
                        binary: 'opencode',
                        message:
                            "This vault hides some notes from AI, and opencode can't honour that yet.",
                    },
                })}
            >
                <Children />
            </ChatSetupGate>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.textContent?.includes(
                "can't honour this vault's hidden notes",
            ),
        ).toBe(true)
        await expect(
            canvasElement.textContent?.includes('chat content'),
        ).toBe(false)
    },
}

/** The active provider's CLI (claude) isn't installed — full install copy, one-click switch to
 *  opencode. */
export const ClaudeMissing: Story = {
    render: () => (
        <Frame>
            <ChatSetupGate
                session={makeStubChatSession({
                    setupError: 'claude',
                    provider: 'claude',
                })}
            >
                <Children />
            </ChatSetupGate>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.textContent?.includes("Claude Code isn't available"),
        ).toBe(true)
        await expect(
            canvasElement.textContent?.includes('Install Claude Code and sign in'),
        ).toBe(true)
    },
}

/** opencode is the active provider but its CLI isn't found — the install copy names the exact
 *  brew command, one-click switch to Claude Code. */
export const OpencodeMissing: Story = {
    render: () => (
        <Frame>
            <ChatSetupGate
                session={makeStubChatSession({
                    setupError: 'opencode',
                    provider: 'opencode',
                })}
            >
                <Children />
            </ChatSetupGate>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.textContent?.includes("opencode isn't available"),
        ).toBe(true)
        await expect(
            canvasElement.textContent?.includes('brew install sst/tap/opencode'),
        ).toBe(true)
    },
}

/** `compact`: the daemon page's centre column — the dead end sits at its own content height
 *  instead of stretching to fill a taller host. */
export const Compact: Story = {
    render: () => (
        <div style={{ height: '480px', width: '340px', border: '1px solid var(--border-soft)' }}>
            <ChatSetupGate
                compact
                session={makeStubChatSession({ setupError: 'claude' })}
            >
                <Children />
            </ChatSetupGate>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const setup = canvasElement.querySelector<HTMLElement>(
            '[class*="chat-setup"]',
        )!
        // Compact: the dead end's own content height is well short of the 480px host — it does
        // not stretch to fill it.
        await expect(setup.getBoundingClientRect().height).toBeLessThan(300)
    },
}
