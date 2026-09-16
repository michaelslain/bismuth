// Visual spec for <ChatModelMenu> — the row's one control folding provider/model/effort behind the
// current model word (Task 2). CHAT_PROVIDER_OPTIONS is a real, module-level constant (the backend
// catalog) with several entries in every build this app ships, so a story cannot exercise the
// "provider row omitted" branch by shrinking it — that would need mocking a shared module out from
// under every other story that imports chatProvider.ts. The "row omitted when there's only one
// choice" behaviour is identical code for all three rows (`length > 1` gates each independently), so
// OneModel below exercises it via the model row instead, with a real (non-empty) provider list left
// alone.
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
    { value: 'opus', label: 'Opus 4.8', description: 'Most capable', effortLevels: ['low', 'medium', 'high'] },
    { value: 'sonnet', label: 'Sonnet 4.5', description: 'Balanced', effortLevels: ['low', 'medium', 'high'] },
]

const EFFORT_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
]

/** All three rows present: several providers (the real catalog), several models, several efforts.
 *  The trigger itself just shows the current model word — the menu is closed here. */
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
        await expect(canvas.getByText('opus 4.8')).not.toBeNull()
    },
}

/** Only one model to pick from: the model row's own submenu would offer nothing to choose, so
 *  ChatModelMenu omits it — the same "no real choice, don't show a dead submenu" rule the provider
 *  and effort rows follow via their own `length > 1` gates. Effort still has a real choice, so its
 *  row stays. */
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
        await expect(canvas.getByText('opus 4.8')).not.toBeNull()
    },
}

/** The menu OPEN, via play() — the submenu chrome (rows, the current-value `detail`, the `Check`
 *  icon on the active row) needs to actually render for a visual check to see it. */
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
            expect(document.querySelectorAll('.bismuth-popover-row').length).toBeGreaterThan(0)
        })
        // The three top-level rows this session's choices earn.
        expect(document.body.textContent).toContain('provider')
        expect(document.body.textContent).toContain('model')
        expect(document.body.textContent).toContain('effort')
    },
}
