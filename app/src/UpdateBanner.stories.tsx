// Visual spec for <UpdateBanner> — the slim top bar shown when the source-built app is
// behind origin/main. UpdateBanner takes no props; it reads a MODULE-LEVEL signal
// (updateCheck.ts's `updateStatus`) that only fills in from a real GET /update/status —
// updateCheck.ts calls `startUpdateChecks()` unconditionally at import time, which checks
// once immediately and then polls, but the shared fakeTransport has no /update/status route
// (an unhandled GET throws, caught silently — the banner just never appears).
//
// This file layers ONE extra GET handler on top of the shared fakeTransport (scoped to these
// stories only) and calls updateCheck.ts's own exported `recheckUpdate()` — the same
// "call the imperative populate function inside the story's render" pattern Toast.tsx's
// pushToast() uses — so the banner reflects the seeded status immediately instead of waiting
// on the module's own retry interval.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { UpdateBanner } from './UpdateBanner'
import { recheckUpdate } from './updateCheck'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import type { Transport } from './api'
import type { UpdateStatus } from '../../core/src/selfUpdate'

function statusTransport(status: UpdateStatus): Transport {
    const base = fakeTransport()
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/update/status') return status as unknown as T
            return base.getJson<T>(path)
        },
    }
}

const meta = {
    title: 'App/UpdateBanner',
    component: UpdateBanner,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof UpdateBanner>

export default meta
type Story = StoryObj<typeof meta>

/** Several commits behind — the common case. */
export const Default: Story = {
    render: () => {
        setTransport(
            statusTransport({
                available: true,
                behind: 5,
                localSha: 'abc1234',
                remoteSha: 'def5678',
                builtSha: 'abc1234',
                dirty: false,
            }),
        )
        recheckUpdate()
        return <UpdateBanner />
    },
}

/** Exactly one commit behind — the singular "commit" (vs "commits") pluralization branch. */
export const OneCommitBehind: Story = {
    render: () => {
        setTransport(
            statusTransport({
                available: true,
                behind: 1,
                localSha: 'abc1234',
                remoteSha: 'def5678',
                builtSha: 'abc1234',
                dirty: false,
            }),
        )
        recheckUpdate()
        return <UpdateBanner />
    },
}
