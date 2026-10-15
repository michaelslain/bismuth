// Visual spec for <DaemonSetupModal> — "Set up daemon" panel. Fetches GET /daemon/install +
// GET /daemon/status via Promise.allSettled in onMount, so unlike the other status-fetching
// modals it never even hits its own try/catch: the fake transport (.storybook/preview.ts;
// only /tree, /version, /file, /rows answered) rejects both individual promises, allSettled
// swallows them, and `loading` clears the normal way with `status`/`owner` staying null —
// "Installed: no", "Running: no", "Owner: unclaimed".
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { createSignal } from 'solid-js'
import { DaemonSetupModal } from './DaemonSetupModal'
import { TextButton } from '../ui/TextButton'

const meta = {
    title: 'Modals/DaemonSetupModal',
    component: DaemonSetupModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonSetupModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Open, onClose a no-op. Neither status fetch resolves, so the panel shows "Installed: no",
 *  "Running: no", "Owner: unclaimed" — not stuck on "Loading daemon status…". */
export const Default: Story = {
    render: () => <DaemonSetupModal onClose={noop} />,
}

/** Interactive: a trigger opens the modal; its header `[x]` (or Escape) closes it — exercising the
 *  onClose callback Default no-ops. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div style={{ padding: '40px' }}>
                <TextButton
                    variant="selected"
                    onClick={() => setOpen(true)}
                >
                    open daemon setup
                </TextButton>
                {open() && <DaemonSetupModal onClose={() => setOpen(false)} />}
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const close = await waitFor(() => {
            const b = doc.querySelector<HTMLButtonElement>('button[data-modal-close]')
            expect(b).not.toBeNull()
            return b!
        })
        expect(close.getAttribute('aria-label')).toBe('Close')
        // the header `[x]` is a TextButton reading `x`; the brackets are drawn by its style
        expect(close.textContent?.trim()).toBe('x')
        const footerClose = [...doc.querySelectorAll('button')].filter(
            b => b !== close && /^\s*close\s*$/i.test(b.textContent ?? ''),
        )
        expect(footerClose.length).toBe(0)
    },
}
