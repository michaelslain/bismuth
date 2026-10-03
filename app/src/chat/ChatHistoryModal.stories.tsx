// Visual spec for <ChatHistoryModal> — the history dialog over a chat. The dialog portals to
// <body>, so play() functions look it up on `document`, never on the story canvas. The panel's
// own states (empty, searching, narrow, …) are ChatHistoryPanel's stories; these cover the shell.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ChatHistoryModal from './ChatHistoryModal'
import type { ChatHistoryState } from './chatSession'
import type { ChatScope, ChatSessionInfo } from '../api'
import { chatHistoryFixture } from './_chatHistoryFixtures'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'

const meta = {
    title: 'Chat/ChatHistoryModal',
    component: ChatHistoryModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatHistoryModal>

export default meta
type Story = StoryObj<typeof meta>

function makeHistory(
    sessions: ChatSessionInfo[],
    open: () => boolean,
    setOpen: (v: boolean) => void,
): ChatHistoryState {
    const [scope, setScope] = createSignal<ChatScope>('all')
    const [query, setQuery] = createSignal('')
    return {
        open,
        loading: () => false,
        sessions: () =>
            sessions.filter(s =>
                scope() === 'all'
                    ? true
                    : scope() === 'daemon'
                      ? s.origin === 'daemon'
                      : s.origin !== 'daemon',
            ),
        scope,
        query,
        searchHits: () => [],
        searchLoading: () => false,
        toggle: () => setOpen(!open()),
        close: () => setOpen(false),
        setScope,
        setQuery,
        resume: async () => setOpen(false),
    }
}

/** Open over a page, with a `[history]` button to bring it back after closing — so close (×, the
 *  scrim, Escape), reopen and resume can all be tried by hand. */
export const Open: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        const history = makeHistory(
            chatHistoryFixture().map(h => h.session),
            open,
            setOpen,
        )
        return (
            <div style={{ padding: 'var(--sp-6)', height: '600px' }}>
                <Text size="ui" tone="muted">
                    the chat underneath stays mounted
                </Text>
                <TextButton onClick={() => setOpen(true)}>history</TextButton>
                <Show when={open()}>
                    <ChatHistoryModal
                        history={history}
                        onNewChat={() => setOpen(false)}
                    />
                </Show>
            </div>
        )
    },
    play: async () => {
        const body = within(document.body)
        await waitFor(() =>
            expect(
                body.getByRole('dialog', { name: 'Chat history' }),
            ).toBeInTheDocument(),
        )
        await expect(
            body.getByText('Restyle the daemon page'),
        ).toBeInTheDocument()
        // The prompt has focus on open — typing searches immediately.
        await waitFor(() =>
            expect(document.activeElement).toBe(
                document.querySelector('input[placeholder="conversations"]'),
            ),
        )
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
    },
}
