// Visual spec for <AgentSwitchRow> — the setup screen's row of installed agents. Labels come in
// as the catalog's real ones and render lowercased.
import { expect, fn, userEvent, within } from 'storybook/test'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import AgentSwitchRow from './AgentSwitchRow'
import Text from '../ui/Text'

const meta = {
    title: 'Chat/AgentSwitchRow',
    component: AgentSwitchRow,
    parameters: { layout: 'centered' },
    args: {
        backends: [
            { id: 'codex', label: 'OpenAI Codex' },
            { id: 'gemini', label: 'Gemini CLI' },
        ],
        onPick: fn(),
    },
} satisfies Meta<typeof AgentSwitchRow>

export default meta
type Story = StoryObj<typeof meta>

export const Two: Story = {
    play: async ({ canvasElement, args }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'openai codex' }))
        await expect(args.onPick).toHaveBeenCalledWith('codex')
        await expect(c.getByRole('button', { name: 'gemini cli' })).toBeTruthy()
    },
}

/** No other agent installed: the row renders nothing. The caption is the story's own frame, so the
 *  shot is not an empty canvas. */
export const Empty: Story = {
    args: { backends: [] },
    render: args => (
        <div>
            <Text tone="faint" size="micro">
                (no other agent installed: the row renders nothing)
            </Text>
            <AgentSwitchRow {...args} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('button').length).toBe(0)
    },
}

/** The free agent as a peer after the installed agents; `disabled` while an install runs. */
export const WithFreeAgent: Story = {
    args: { freeAgentLabel: 'free agent', onFreeAgent: fn() },
    play: async ({ canvasElement, args }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: 'free agent' }))
        await expect(args.onFreeAgent).toHaveBeenCalled()
    },
}

export const FreeAgentOnly: Story = {
    args: { backends: [], freeAgentLabel: 'set up free agent', onFreeAgent: fn() },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('button').length).toBe(1)
    },
}

export const Busy: Story = {
    args: { freeAgentLabel: 'free agent', onFreeAgent: fn(), disabled: true },
    play: async ({ canvasElement }) => {
        for (const b of canvasElement.querySelectorAll('button'))
            await expect((b as HTMLButtonElement).disabled).toBe(true)
    },
}
