// Visual spec for <ChatModelPicker> — the ONE model dialog: connectors on the left, the current
// connector's models / effort / (opencode) provider manager on the right, under a `model //
// <connector>` header over the scrim. Every story hands it a stub session (no socket); the dialog
// portals itself, so the stories are fullscreen. The opencode story's provider lists come from the
// preview's fakeTransport.
import { Show, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import ChatModelPicker from './ChatModelPicker'
import {
    makeStubChatSession,
    type StubChatSessionInit,
} from './_stubChatSession'

const meta = {
    title: 'Chat/ChatModelPicker',
    component: ChatModelPicker,
    parameters: { layout: 'fullscreen' },
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

/** The dialog over its scrim. `narrow` clamps the panel to 328px — a 360px viewport's
 *  `max-width: calc(100vw - 32px)` — since a story cannot resize the viewport itself. */
const hosted =
    (init: StubChatSessionInit, narrow?: boolean): (() => JSX.Element) =>
    () => {
        const session = makeStubChatSession(init)
        return (
            <>
                <Show when={narrow}>
                    <style>{`[role="dialog"][data-modal-panel] { width: 328px; max-width: 328px; }`}</style>
                </Show>
                <ChatModelPicker {...{ session }} onClose={() => {}} />
            </>
        )
    }

const findPanel = async (canvasElement: HTMLElement) =>
    waitFor(() => {
        const el =
            canvasElement.ownerDocument.body.querySelector<HTMLElement>(
                '[role="dialog"]',
            )
        if (!el) throw new Error('picker not rendered yet')
        return el
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
        // the connector appears twice: the header subtitle and its row in the left column
        await expect(c.getAllByText('claude code').length).toBe(2)
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

/** A 360px phone: the dialog shrinks to the viewport minus its gutters and the connector column to its floor. */
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
            328,
        )
        await within(panel).findByPlaceholderText('add a provider…')
    },
}
