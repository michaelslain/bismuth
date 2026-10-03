// Visual spec for <ChatModelPicker> — the ONE model panel: connectors on the left, the current
// connector's models / effort / (opencode) provider manager on the right. Every story hands the
// panel a stub session (no socket) and a real trigger button to anchor against, the way
// ChatModelMenu does. The opencode story's provider lists come from the preview's fakeTransport.
import { createSignal, Show, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import ChatModelPicker from './ChatModelPicker'
import PlainButton from '../ui/PlainButton'
import {
    makeStubChatSession,
    type StubChatSessionInit,
} from './_stubChatSession'

const meta = {
    title: 'Chat/ChatModelPicker',
    component: ChatModelPicker,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatModelPicker>

export default meta
type Story = StoryObj<typeof meta>

const model = (value: string, label = value, free?: boolean) => ({
    value,
    label,
    description: '',
    effortLevels: [],
    free,
})

const CLAUDE_MODELS = [
    model('opus', 'Opus 4.8'),
    model('sonnet', 'Sonnet 4.5'),
    model('haiku', 'Haiku 4.5'),
]

const OPENCODE_MODELS = [
    model('anthropic/claude-sonnet-4-5'),
    model('anthropic/claude-opus-4-8'),
    model('opencode/kimi-k2', 'opencode/kimi-k2', true),
    model('opencode/big-pickle', 'opencode/big-pickle', true),
    model('local/qwen3-coder-30b'),
]

const EFFORT = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
]

/** A trigger word near the top of the story with the panel anchored beneath it. `narrow` clamps the
 *  panel to 92% of a 360px viewport (the real `max-width: min(560px, 92vw)` at that width). */
const hosted =
    (init: StubChatSessionInit, narrow?: boolean): (() => JSX.Element) =>
    () => {
        const session = makeStubChatSession(init)
        const [anchor, setAnchor] = createSignal<HTMLElement>()
        return (
            <div style={{ height: '680px' }}>
                <Show when={narrow}>
                    <style>{`[data-chat-model-picker] { width: 331px; max-width: 331px; }`}</style>
                </Show>
                <PlainButton
                    ref={setAnchor}
                    data-chat-model-anchor
                    style={{ margin: '24px 0 0 0', color: 'var(--faint)' }}
                >
                    {init.displayModel || 'default model'}
                </PlainButton>
                <Show when={anchor()}>
                    {a => (
                        <ChatModelPicker
                            {...{ session }}
                            anchor={a()}
                            onClose={() => {}}
                        />
                    )}
                </Show>
            </div>
        )
    }

const findPanel = async (canvasElement: HTMLElement) =>
    waitFor(() => {
        const el = canvasElement.querySelector('[data-chat-model-picker]')
        if (!el) throw new Error('picker not rendered yet')
        return el as HTMLElement
    })

/** claude code: three models, the current one checked, and an effort row. */
export const ClaudeCode: Story = {
    render: hosted({
        provider: 'claude',
        models: CLAUDE_MODELS,
        displayModel: 'opus',
        displayModelValue: 'opus',
        effortOptions: EFFORT,
        effortValue: 'medium',
    }),
    play: async ({ canvasElement }) => {
        const panel = await findPanel(canvasElement)
        const c = within(panel)
        await expect(c.getByText('model')).not.toBeNull()
        await expect(c.getByText('Opus 4.8')).not.toBeNull()
        await expect(c.getByText('effort')).not.toBeNull()
        await expect(panel.querySelectorAll('svg').length).toBe(1)
    },
}

/** codex reporting no models: the honest empty line, no effort row. */
export const CodexNoModels: Story = {
    render: hosted({ provider: 'codex', models: [], displayModel: '' }),
    play: async ({ canvasElement }) => {
        const c = within(await findPanel(canvasElement))
        await expect(c.getByText('no models reported')).not.toBeNull()
        await expect(c.queryByText('effort')).toBeNull()
    },
}

/** opencode: models grouped by provider (free right-aligned), then the provider manager. */
export const OpencodeGrouped: Story = {
    render: hosted({
        provider: 'opencode',
        models: OPENCODE_MODELS,
        displayModel: 'anthropic/claude-sonnet-4-5',
        displayModelValue: 'anthropic/claude-sonnet-4-5',
    }),
    play: async ({ canvasElement }) => {
        const panel = await findPanel(canvasElement)
        const c = within(panel)
        await expect(c.getAllByText('anthropic').length).toBe(2)
        await expect(c.getByText('kimi-k2')).not.toBeNull()
        await expect(c.getAllByText('free').length).toBe(2)
        await c.findByPlaceholderText('add a provider…')
    },
}

/** A 360px phone: the panel shrinks to 92vw and the connector column to its floor. */
export const Narrow360: Story = {
    render: hosted(
        {
            provider: 'opencode',
            models: OPENCODE_MODELS,
            displayModel: 'anthropic/claude-sonnet-4-5',
            displayModelValue: 'anthropic/claude-sonnet-4-5',
        },
        true,
    ),
    play: async ({ canvasElement }) => {
        const panel = await findPanel(canvasElement)
        await expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(
            332,
        )
        await within(panel).findByPlaceholderText('add a provider…')
    },
}
