// Visual spec for <ToastHost> — the fixed bottom-center toast stack. ToastHost itself takes
// no props; it reads a MODULE-LEVEL signal (`toasts`) that only `pushToast()` populates, so
// each story calls it imperatively before rendering the host (the same pattern the daemon
// inbox's "N pages ready for review" toast uses in production — see serverVersion.ts / App.tsx).
//
// `reset()` clears any toast left over from a PREVIOUS story view in this session — every
// story here pushes with ttl=0 (pushToast's documented "persistent, no auto-dismiss" mode) so
// it stays on screen for the spec, which would otherwise stack up indefinitely across repeated
// visits in one Storybook session.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { ToastHost, pushToast, dismissToast, toasts } from './ToastHost'
import { showUpdateFailureWith } from '../updateFailure'

function reset(): void {
    for (const t of toasts()) dismissToast(t.id)
}

const meta = {
    title: 'UI/ToastHost',
    component: ToastHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ToastHost>

export default meta
type Story = StoryObj<typeof meta>

/** A single plain toast. */
export const Default: Story = {
    render: () => {
        reset()
        pushToast('Enabled dream', { ttl: 0 })
        return <ToastHost />
    },
}

/** A stack of two, the top one carrying an action button (the daemon inbox's
 *  "N pages ready for review" → "review" shape). */
export const StackWithAction: Story = {
    render: () => {
        reset()
        pushToast("Couldn't run vault-review", { ttl: 0 })
        pushToast('3 reply drafts ready for review', {
            ttl: 0,
            action: { label: 'review', onClick: () => {} },
        })
        return <ToastHost />
    },
}

/** A failure toast. It must NOT read like the info toast above it: danger ink + hairline. */
export const Danger: Story = {
    render: () => {
        reset()
        pushToast('Enabled dream', { ttl: 0 })
        pushToast('Rename failed: EEXIST', { ttl: 0, tone: 'danger' })
        return <ToastHost />
    },
}

/** A timed toast (no dismiss control — it leaves on its own) above a persistent progress toast
 *  (carries a dismiss control, since nothing else would ever take it off screen). */
export const PersistentProgress: Story = {
    render: () => {
        reset()
        pushToast('Saved', { ttl: 3_600_000 })
        pushToast('Syncing Google Calendar…', { ttl: 0 })
        return <ToastHost />
    },
}

/** A self-update stopped because the source clone and origin/main diverged: a danger toast whose
 *  action resets to upstream. Pushed through the real `showUpdateFailureWith`, so it carries that
 *  toast's own 20 s ttl rather than this file's ttl=0. */
export const UpdateDiverged: Story = {
    render: () => {
        reset()
        showUpdateFailureWith(
            {
                result: 'error',
                message:
                    'the Bismuth clone has 3 commits origin/main lacks — reset saves them on a backup branch and moves to origin/main',
                diverged: true,
            },
            { reapply: async () => ({ result: 'up-to-date' }) },
        )
        return <ToastHost />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText(/^Update failed: the Bismuth clone has 3 commits/),
        ).toBeInTheDocument()
        await expect(canvas.getByText('reset')).toBeInTheDocument()
    },
}
