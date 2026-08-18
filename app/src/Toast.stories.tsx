// Visual spec for <ToastHost> — the fixed bottom-center toast stack. ToastHost itself takes
// no props; it reads a MODULE-LEVEL signal (`toasts`) that only `pushToast()` populates, so
// each story calls it imperatively before rendering the host (the same pattern the daemon
// inbox's "N pages ready for review" toast uses in production — see serverVersion.ts / App.tsx).
//
// `reset()` clears any toast left over from a PREVIOUS story view in this session — every
// story here pushes with ttl=0 (Toast.tsx's documented "persistent, no auto-dismiss" mode) so
// it stays on screen for the spec, which would otherwise stack up indefinitely across repeated
// visits in one Storybook session.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { ToastHost, pushToast, dismissToast, toasts } from './Toast'

function reset(): void {
    for (const t of toasts()) dismissToast(t.id)
}

const meta = {
    title: 'App/ToastHost',
    component: ToastHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ToastHost>

export default meta
type Story = StoryObj<typeof meta>

/** A single plain toast. */
export const Default: Story = {
    render: () => {
        reset()
        pushToast('Enabled dream', undefined, 0)
        return <ToastHost />
    },
}

/** A stack of two, the top one carrying an action button (the daemon inbox's
 *  "N pages ready for review" → "REVIEW" shape). */
export const StackWithAction: Story = {
    render: () => {
        reset()
        pushToast("Couldn't run vault-review", undefined, 0)
        pushToast(
            '3 reply drafts ready for review',
            { label: 'Review', onClick: () => {} },
            0,
        )
        return <ToastHost />
    },
}
