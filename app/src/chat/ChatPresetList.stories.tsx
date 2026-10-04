// Visual spec for <ChatPresetList> — the model dialog's presets section, rendered at the width of
// the dialog's left column. The list lives in a real signal and onApply moves `current` to the picked
// preset, so the stories can be clicked through: pick one (its ▸ moves), save the current setup
// under a name (a row appears), delete one (it goes).
import { createSignal, type JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ChatPresetList from './ChatPresetList'
import {
    deletePreset,
    savePreset,
    type ChatPreset,
    type ChatPresetCurrent,
} from './chatPresets'

const meta = {
    title: 'Chat/ChatPresetList',
    component: ChatPresetList,
} satisfies Meta<typeof ChatPresetList>

export default meta
type Story = StoryObj<typeof meta>

const PRESETS: ChatPreset[] = [
    { name: 'quick', provider: 'claude', model: 'haiku', effort: 'low' },
    { name: 'deep work', provider: 'claude', model: 'opus', effort: 'max' },
    { name: 'codex review', provider: 'codex', model: 'gpt-5-codex', effort: 'high' },
]

const LABELS: Record<string, string> = {
    claude: 'claude code',
    codex: 'codex',
    haiku: 'haiku 4.5',
    opus: 'opus 4.8',
}
const describe = (p: ChatPreset) =>
    [LABELS[p.provider] ?? p.provider, LABELS[p.model] ?? p.model, p.effort]
        .filter(Boolean)
        .join(' // ')

/** The list in a 150px column (the dialog's left column at its widest), on real state. */
const hosted =
    (presets: ChatPreset[], current: ChatPresetCurrent): (() => JSX.Element) =>
    () => {
        const [list, setList] = createSignal(presets)
        const [cur, setCur] = createSignal(current)
        return (
            <div style={{ width: '150px' }}>
                <ChatPresetList
                    presets={list()}
                    current={cur()}
                    suggestedName={[LABELS[cur().model] ?? cur().model, cur().effort]
                        .filter(Boolean)
                        .join(' ')}
                    {...{ describe }}
                    onApply={p => setCur({ provider: p.provider, model: p.model, effort: p.effort })}
                    onSave={name => setList(l => savePreset(l, { name, ...cur() }))}
                    onDelete={i => setList(l => deletePreset(l, i))}
                />
            </div>
        )
    }

/** Three presets; the chat is running `deep work`, so it carries the ▸. */
export const Default: Story = {
    render: hosted(PRESETS, { provider: 'claude', model: 'opus', effort: 'max' }),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('presets')).not.toBeNull()
        const current = canvasElement.querySelector('[aria-current]')
        await expect(current?.textContent).toContain('deep work')
        await expect(c.getByTitle('deep work — claude code // opus 4.8 // max')).not.toBeNull()
    },
}

/** Nothing saved yet: just the heading and `+ save`. */
export const Empty: Story = {
    render: hosted([], { provider: 'claude', model: 'sonnet', effort: 'high' }),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('save')).not.toBeNull()
    },
}

/** Clicking a preset moves the ▸ to it. */
export const ApplyMovesMark: Story = {
    render: hosted(PRESETS, { provider: 'claude', model: 'opus', effort: 'max' }),
    play: async ({ canvasElement }) => {
        await userEvent.click(within(canvasElement).getByText('quick'))
        await waitFor(() =>
            expect(canvasElement.querySelector('[aria-current]')?.textContent).toContain(
                'quick',
            ),
        )
    },
}

/** `+ save` → type a name → Enter appends a row that is immediately the current one. */
export const SaveCurrent: Story = {
    render: hosted(PRESETS.slice(0, 1), { provider: 'claude', model: 'opus', effort: 'high' }),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByText('save'))
        const input = await c.findByLabelText('Preset name')
        await expect((input as HTMLInputElement).value).toBe('opus 4.8 high')
        await userEvent.clear(input)
        await userEvent.type(input, 'thinking{Enter}')
        await waitFor(() =>
            expect(canvasElement.querySelector('[aria-current]')?.textContent).toContain(
                'thinking',
            ),
        )
    },
}

/** The `[x]` deletes only its own row. */
export const DeleteOne: Story = {
    render: hosted(PRESETS, { provider: 'claude', model: 'opus', effort: 'max' }),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByLabelText('Delete preset quick'))
        await waitFor(() => expect(c.queryByText('quick')).toBeNull())
        await expect(c.getByText('deep work')).not.toBeNull()
    },
}

/** `+ save`, then click away (here: onto a preset) — the name box cancels, nothing is saved. */
export const SaveClickAwayCancels: Story = {
    render: hosted(PRESETS.slice(0, 2), { provider: 'claude', model: 'opus', effort: 'high' }),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByText('save'))
        await c.findByLabelText('Preset name')
        await userEvent.click(c.getByText('quick'))
        await waitFor(() => expect(c.queryByLabelText('Preset name')).toBeNull())
        await expect(canvasElement.querySelectorAll('[aria-label^="Delete preset"]').length).toBe(2)
    },
}
