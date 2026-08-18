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
import { createSignal } from 'solid-js'
import { BismuthInstallModal } from './BismuthInstallModal'
import { Button } from './ui/Button'

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

/** Interactive: a trigger opens the modal; its own CLOSE button (or Escape) closes it —
 *  exercising the onClose callback Default no-ops. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(true)
        return (
            <div style={{ padding: '40px' }}>
                <Button
                    kind="text"
                    state="selected"
                    onClick={() => setOpen(true)}
                >
                    Open install panel
                </Button>
                {open() && (
                    <BismuthInstallModal onClose={() => setOpen(false)} />
                )}
            </div>
        )
    },
}
