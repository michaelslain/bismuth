// Visual spec for <BismuthInstallModal> — "Install Bismuth CLI + MCP" panel. It fetches
// GET /bismuth/install in onMount for status and POSTs /bismuth/install to (re)install.
//
// The Storybook-wide fakeTransport (.storybook/preview.ts) only answers GET /tree,
// GET /version, GET /file and POST /rows — everything else (including this modal's
// /bismuth/install) throws "unhandled GET/POST". The modal's own onMount try/catch/finally
// treats that the same as "couldn't reach an install" (pushToast + loading cleared), so it
// still renders past the spinner into a real panel — all-"no" rather than a version report —
// instead of hanging. That's the state Default below shows.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { createSignal } from 'solid-js'
import { BismuthInstallModal } from './BismuthInstallModal'
import { TextButton } from './ui/TextButton'

const meta = {
    title: 'Modals/BismuthInstallModal',
    component: BismuthInstallModal,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BismuthInstallModal>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Open, onClose a no-op. The fake transport can't answer the status fetch, so onMount's
 *  catch clears `loading` with `status` still null — "CLI on PATH: no", "MCP registered:
 *  no", no version line. It does NOT get stuck showing "Loading install status…". */
export const Default: Story = {
    render: () => <BismuthInstallModal onClose={noop} />,
}

/** Interactive: a trigger opens the modal; its header `[x]` (or Escape) closes it —
 *  exercising the onClose callback Default no-ops. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div style={{ padding: '40px' }}>
                <TextButton
                    variant="selected"
                    onClick={() => setOpen(true)}
                >
                    open install panel
                </TextButton>
                {open() && (
                    <BismuthInstallModal onClose={() => setOpen(false)} />
                )}
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
