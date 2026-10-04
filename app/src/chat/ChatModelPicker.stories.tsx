// Visual spec for <ChatModelPicker> — the ONE model dialog: connectors on the left, the current
// connector's models / effort / (opencode) provider manager on the right, under a `model //
// <connector>` header over the scrim. Every story hands it a stub session (no socket); the dialog
// portals itself, so the stories are fullscreen. The opencode story's provider lists come from the
// preview's fakeTransport.
import { batch, createSignal, onCleanup, Show, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ChatModelPicker from './ChatModelPicker'
import {
    makeStubChatSession,
    type StubChatSessionInit,
} from './_stubChatSession'
import { settings, setSettings } from '../settings'
import type { ChatPreset } from './chatPresets'
import type { ChatControlsView } from './ChatControls'
import type { ChatModelOption } from './chatSession'
import type { ChatProviderChoice } from '../chatProvider'

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
        // the current model carries the same ▸ as the current connector — no check icon
        const marked = [...panel.querySelectorAll('[aria-current]')].map(
            el => el.textContent?.trim() ?? '',
        )
        await expect(marked).toContain('▸Opus 4.8')
        await expect(
            panel.querySelectorAll('button[aria-current] svg').length,
        ).toBe(0)
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

const PRESETS: ChatPreset[] = [
    { name: 'quick', provider: 'claude', model: 'haiku', effort: 'low' },
    { name: 'deep work', provider: 'claude', model: 'opus', effort: 'medium' },
    { name: 'codex review', provider: 'codex', model: 'gpt-5-codex', effort: 'high' },
]

/** A controls view on REAL state, for a story meant to be clicked: connector, model and effort
 *  are signals, and every pick — a connector, a model, an effort, a preset — updates them, so the
 *  `▸`, the model check and the effort toggle all follow (the stub session only records calls). */
function liveSession(): ChatControlsView {
    const [provider, setProvider] = createSignal<ChatProviderChoice>('claude')
    const [modelValue, setModelValue] = createSignal('opus')
    const [effort, setEffort] = createSignal('medium')
    const models = () => LIVE_MODELS[provider()] ?? []
    const effortOptions = () =>
        (models().find(m => m.value === modelValue())?.effortLevels ?? []).map(
            l => ({ value: l, label: l }),
        )
    const effortValue = () =>
        effortOptions().some(o => o.value === effort())
            ? effort()
            : (effortOptions()[0]?.value ?? '')
    const switchProvider = (p: string) =>
        batch(() => {
            setProvider(p as ChatProviderChoice)
            setModelValue(models()[0]?.value ?? '')
        })
    return {
        provider,
        models,
        displayModel: modelValue,
        displayModelValue: modelValue,
        effortOptions,
        effortValue,
        permMode: () => 'bypassPermissions',
        switchProvider,
        switchModel: setModelValue,
        switchEffort: setEffort,
        applyPreset: p =>
            batch(() => {
                setProvider(p.provider as ChatProviderChoice)
                setModelValue(p.model || (models()[0]?.value ?? ''))
                if (p.effort) setEffort(p.effort)
            }),
        setPermissionMode: () => {},
        startNewChat: () => {},
        history: { open: () => false, toggle: () => {} },
    }
}

const LEVELS = ['low', 'medium', 'high', 'max']
const LIVE_MODELS: Partial<Record<ChatProviderChoice, ChatModelOption[]>> = {
    claude: [
        { ...model('opus', 'Opus 4.8'), effortLevels: LEVELS },
        { ...model('sonnet', 'Sonnet 4.5'), effortLevels: LEVELS },
        { ...model('haiku', 'Haiku 4.5'), effortLevels: ['low', 'medium', 'high'] },
    ],
    codex: [
        { ...model('gpt-5-codex'), effortLevels: ['low', 'medium', 'high'] },
        { ...model('gpt-5'), effortLevels: ['low', 'medium', 'high'] },
    ],
    opencode: OPENCODE_MODELS,
}

/** Saved presets above the connectors, on real state — click around: a preset moves the
 *  connector `▸`, the model check and the effort with it; `[+ save]` adds the current setup;
 *  `[x]` removes one. `deep work` (opus + medium) matches at first. The presets are put in the real
 *  settings store for the story and restored after. */
export const WithPresets: Story = {
    render: () => {
        const before = settings.chat.presets
        setSettings('chat', 'presets', PRESETS)
        onCleanup(() => setSettings('chat', 'presets', before))
        // Built ONCE, outside the JSX: `session={liveSession()}` compiles to a prop GETTER, so every
        // `props.session` read would build a fresh session and no click would ever show.
        const session = liveSession()
        return <ChatModelPicker {...{ session }} onClose={() => {}} />
    },
    play: async ({ canvasElement }) => {
        const panel = await findPanel(canvasElement)
        const c = within(panel)
        await expect(c.getByText('presets')).not.toBeNull()
        await expect(
            c.getByTitle('deep work — claude code // opus 4.8 // medium'),
        ).not.toBeNull()
        await expect(
            c.getByTitle('codex review — openai codex // gpt-5-codex // high'),
        ).not.toBeNull()
        await expect(c.getByText('connectors')).not.toBeNull()
        const marked = [...panel.querySelectorAll('[aria-current]')].map(
            el => el.textContent ?? '',
        )
        await expect(marked.some(t => t.includes('deep work'))).toBe(true)
    },
}

/** The same live dialog, clicked: picking `codex review` moves the connector `▸` to openai codex,
 *  checks gpt-5-codex and selects `high`; then `[+ save]` → a name → Enter adds a preset that is
 *  immediately the current one. */
export const PresetsClickThrough: Story = {
    render: WithPresets.render,
    play: async ({ canvasElement }) => {
        const panel = await findPanel(canvasElement)
        const c = within(panel)
        const current = () =>
            [...panel.querySelectorAll('[aria-current]')].map(
                el => el.textContent ?? '',
            )
        await userEvent.click(c.getByText('codex review'))
        await waitFor(() => {
            expect(current().some(t => t.includes('openai codex'))).toBe(true)
            expect(current().some(t => t.includes('gpt-5-codex'))).toBe(true)
            expect(current().some(t => t.includes('codex review'))).toBe(true)
        })
        await userEvent.click(c.getByText('save'))
        const input = await c.findByLabelText('Preset name')
        await userEvent.clear(input)
        await userEvent.type(input, 'codex twin{Enter}')
        await waitFor(() =>
            expect(current().some(t => t.includes('codex twin'))).toBe(true),
        )
    },
}
