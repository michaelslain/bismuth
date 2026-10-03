// Visual spec for <ChatModelMenu> — the row's one control: the current model word, which opens
// ChatModelPicker (the one dialog for connector / model / effort / opencode providers), which
// portals itself to <body> over a scrim. The picker's own states live in Chat/ChatModelPicker; these stories prove the trigger
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

/** The picker is a modal portalled to <body>, outside the canvas, so look there. */
const findDialog = (canvasElement: HTMLElement) =>
    waitFor(() => {
        const el =
            canvasElement.ownerDocument.body.querySelector<HTMLElement>(
                '[role="dialog"]',
            )
        if (!el) throw new Error('model dialog not rendered yet')
        return el
    })

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
        await findDialog(canvasElement)
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
        await findDialog(canvasElement)
        // a single model is still listed — the panel always shows the connector's own models
        expect(canvasElement.ownerDocument.body.textContent).toContain(
            'Opus 4.8',
        )
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
        await findDialog(canvasElement)
        // connectors left, the current model checked on the right, effort below it
        const picker = within(await findDialog(canvasElement))
        // header subtitle + the connector's own row
        expect(picker.getAllByText('claude code').length).toBe(2)
        expect(picker.getByText('effort')).not.toBeNull()
        expect(picker.getByText('Sonnet 4.5')).not.toBeNull()
    },
}
