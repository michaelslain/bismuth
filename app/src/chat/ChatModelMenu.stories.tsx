// Visual spec for <ChatModelMenu> — the row's one control: the current model word, which opens
// ChatModelPicker (the one panel for connector / model / effort / opencode providers) portalled to
// <body>. The picker's own states live in Chat/ChatModelPicker; these stories prove the trigger
// opens it. The backend catalog (CHAT_PROVIDER_OPTIONS) is a real module-level constant.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import ChatModelMenu from './ChatModelMenu'
import { makeStubChatSession } from './_stubChatSession'

const meta = {
    title: 'Chat/ChatModelMenu',
    component: ChatModelMenu,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatModelMenu>

export default meta
type Story = StoryObj<typeof meta>

const MODELS = [
    {
        value: 'opus',
        label: 'Opus 4.8',
        description: 'Most capable',
        effortLevels: ['low', 'medium', 'high'],
    },
    {
        value: 'sonnet',
        label: 'Sonnet 4.5',
        description: 'Balanced',
        effortLevels: ['low', 'medium', 'high'],
    },
]

const EFFORT_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
]

/** Several connectors (the real catalog), several models, several efforts. Clicking the model
 *  word opens the picker. */
export const AllRows: Story = {
    render: () => (
        <ChatModelMenu
            session={makeStubChatSession({
                models: MODELS,
                displayModel: 'opus',
                displayModelValue: 'opus',
                effortOptions: EFFORT_OPTIONS,
                effortValue: 'medium',
            })}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = await canvas.findByText('opus 4.8')
        trigger.click()
        await waitFor(() => {
            expect(
                document.querySelector('[data-chat-model-picker]'),
            ).not.toBeNull()
        })
    },
}

/** Only one model to pick from: the picker still lists it, checked, so the panel never reads as
 *  broken. */
export const OneModel: Story = {
    render: () => (
        <ChatModelMenu
            session={makeStubChatSession({
                models: [MODELS[0]],
                displayModel: 'opus',
                displayModelValue: 'opus',
                effortOptions: EFFORT_OPTIONS,
                effortValue: 'medium',
            })}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = await canvas.findByText('opus 4.8')
        trigger.click()
        await waitFor(() => {
            expect(
                document.querySelector('[data-chat-model-picker]'),
            ).not.toBeNull()
        })
        // a single model is still listed — the panel always shows the connector's own models
        expect(document.body.textContent).toContain('Opus 4.8')
    },
}

/** The picker OPEN, via play() — the check icon on the current model and the effort row need to
 *  actually render for a visual check to see them. */
export const MenuOpen: Story = {
    render: () => (
        <ChatModelMenu
            session={makeStubChatSession({
                models: MODELS,
                displayModel: 'opus',
                displayModelValue: 'opus',
                effortOptions: EFFORT_OPTIONS,
                effortValue: 'medium',
            })}
        />
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const trigger = await canvas.findByText('opus 4.8')
        trigger.click()
        await waitFor(() => {
            expect(
                document.querySelector('[data-chat-model-picker]'),
            ).not.toBeNull()
        })
        // connectors left, the current model checked on the right, effort below it
        const picker = within(
            document.querySelector<HTMLElement>('[data-chat-model-picker]')!,
        )
        expect(picker.getByText('claude code')).not.toBeNull()
        expect(picker.getByText('effort')).not.toBeNull()
        expect(picker.getByText('Sonnet 4.5')).not.toBeNull()
    },
}
