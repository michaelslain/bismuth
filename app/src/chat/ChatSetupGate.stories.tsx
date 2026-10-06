// Visual spec for <ChatSetupGate> — the shared "this chat can't run" dead end, extracted out of
// ChatView.tsx and DaemonChat.tsx so both compose ONE copy of the install/refusal messaging (final
// review finding: the daemon copy had lost the install instructions and used bare `<p>`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatSetupGate from './ChatSetupGate'
import { makeStubChatSession } from './_stubChatSession'
import Text from '../ui/Text'
import type { FreeAgentStatus } from '../../../core/src/freeAgent'

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

// The gate reads the shared agent-availability store (GET /agents/free); stories pass the status
// instead so they stay deterministic (the fake transport has no such route).
const NO_OPENCODE: FreeAgentStatus = {
    opencode: { installed: false, path: null, managed: false },
    claude: { installed: false },
    backends: [],
    progress: { phase: 'idle' },
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

/** An `auto` chat with nothing installed: three lines, `[set up free agent]` as the row's only button. */
export const NoAgentAuto: Story = {
    render: () => (
        <Frame>
            <ChatSetupGate
                session={makeStubChatSession({
                    setupError: 'claude',
                    provider: 'claude',
                    providerAuto: true,
                })}
                freeAgentStatus={NO_OPENCODE}
            >
                <Children />
            </ChatSetupGate>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const text = canvasElement.textContent ?? ''
        await expect(text).toContain('no agent installed')
        await expect(text).toContain('set up free agent')
        await expect(text).toContain(
            'runs opencode on free models: no account, about 45 MB, prompts may be kept',
        )
        await expect(text).not.toContain('free agent runs')
    },
}

/** Codex was picked explicitly and is missing; Claude Code and Gemini CLI are installed, so the
 *  switch row offers both (the real catalog labels, lowercased). */
export const ExplicitMissingWithOthers: Story = {
    render: () => (
        <Frame>
            <ChatSetupGate
                session={makeStubChatSession({
                    setupError: 'codex',
                    provider: 'codex',
                })}
                freeAgentStatus={{
                    ...NO_OPENCODE,
                    claude: { installed: true },
                    backends: [
                        { id: 'claude', label: 'Claude Code', installed: true },
                        { id: 'opencode', label: 'opencode', installed: false },
                        { id: 'codex', label: 'OpenAI Codex', installed: false },
                        { id: 'gemini', label: 'Gemini CLI', installed: true },
                    ],
                }}
            >
                <Children />
            </ChatSetupGate>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(canvasElement.textContent).toContain(
            "openai codex isn't installed",
        )
        await expect(canvasElement.textContent).toContain(
            'free agent runs opencode on free models: no account, about 45 MB, prompts may be kept',
        )
        await expect(c.getByRole('button', { name: 'free agent' })).toBeTruthy()
        await expect(c.getByRole('button', { name: 'claude code' })).toBeTruthy()
        await expect(c.getByRole('button', { name: 'gemini cli' })).toBeTruthy()
        await expect(c.queryByRole('button', { name: 'openai codex' })).toBeNull()
    },
}

/** An explicit backend is missing and nothing else is installed: no switch row. */
export const ExplicitMissingNoOthers: Story = {
    render: () => (
        <Frame>
            <ChatSetupGate
                session={makeStubChatSession({
                    setupError: 'opencode',
                    provider: 'opencode',
                })}
                freeAgentStatus={NO_OPENCODE}
            >
                <Children />
            </ChatSetupGate>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const text = canvasElement.textContent ?? ''
        await expect(text).toContain(
            "opencode isn't installed",
        )
        await expect(text).toContain('free agent')
        await expect(text).not.toContain('set up free agent')
    },
}

/** `compact`: the daemon page's centre column — the dead end sits at its own content height
 *  instead of stretching to fill a taller host. */
export const Compact: Story = {
    render: () => (
        <div style={{ height: '480px', width: '340px', border: '1px solid var(--border-soft)' }}>
            <ChatSetupGate
                compact
                session={makeStubChatSession({
                    setupError: 'claude',
                    providerAuto: true,
                })}
                freeAgentStatus={NO_OPENCODE}
            >
                <Children />
            </ChatSetupGate>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const setup = canvasElement.querySelector<HTMLElement>(
            '[class*="chat-setup"]',
        )!
        // Compact: the dead end's own content height (with the free-agent block, ~350px at this
        // width) is short of the 480px host — it does not stretch to fill it.
        await expect(setup.getBoundingClientRect().height).toBeLessThan(420)
    },
}
