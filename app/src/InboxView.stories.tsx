// Visual spec for <InboxView> — the ::inbox tab: every daemon-authored page
// (core/src/daemonPages.ts) grouped into "Needs review" / "Scheduled" / "Recently resolved"
// (pure sort/group logic in daemonInboxLogic.ts). InboxView takes no `pages` prop — it reads
// a MODULE-LEVEL signal (daemonInbox.ts's `inboxPages`), populated only by calling
// `refreshDaemonPages()` (which GETs /daemon/pages).
//
// The shared fakeTransport has no /daemon/* routes, so this file layers ONE extra GET handler
// on top of it (scoped to these stories only), then calls refreshDaemonPages() itself inside
// each story's render — the same "call the imperative populate function in render" pattern
// Toast.tsx's pushToast() uses for its own module-level signal.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { InboxView } from './InboxView'
import { refreshDaemonPages } from './daemonInbox'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { sampleDaemonPages } from './ui/_daemonFixtures'
import type { Transport } from './api'
import type { DaemonPage, PageAction } from '../../core/src/daemonPages'

function pagesTransport(pages: DaemonPage[]): Transport {
    const base = fakeTransport()
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/daemon/pages') return pages as unknown as T
            return base.getJson<T>(path)
        },
    }
}

const meta = {
    title: 'App/InboxView',
    component: InboxView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof InboxView>

export default meta
type Story = StoryObj<typeof meta>

/** The fixture's full state matrix: one due page under "Needs review", nothing scheduled,
 *  three terminal pages collapsed under "Recently resolved". */
export const Default: Story = {
    render: () => {
        setTransport(pagesTransport(sampleDaemonPages()))
        void refreshDaemonPages()
        return <InboxView onOpen={() => {}} />
    },
}

const APPROVE: PageAction = {
    id: 'approve',
    label: 'Approve',
    kind: 'primary',
    prompt: 'Go ahead.',
}
const DISMISS: PageAction = { id: 'dismiss', label: 'Dismiss', kind: 'default' }
const now = Date.now()
const HOUR = 60 * 60 * 1000

/** Three due pages sharing the SAME single primary action id — the only shape that surfaces
 *  the "APPROVE ALL" button (sharedPrimaryAction() in daemonInboxLogic.ts requires 2+ pages
 *  agreeing on one primary action). */
export const ManyDueWithApproveAll: Story = {
    render: () => {
        const pages: DaemonPage[] = [
            {
                path: '.daemon/pages/reply-1.md',
                slug: 'reply-1',
                title: 'Reply to Jordan re: lease renewal',
                createdAt: new Date(now - 3 * HOUR).toISOString(),
                source: 'cron:answer-emails',
                actions: [APPROVE, DISMISS],
                body: 'Drafted a reply confirming the September 1st renewal date.',
                status: 'pending',
            },
            {
                path: '.daemon/pages/reply-2.md',
                slug: 'reply-2',
                title: 'Reply to the internship recruiter',
                createdAt: new Date(now - 2 * HOUR).toISOString(),
                source: 'cron:answer-emails',
                actions: [APPROVE, DISMISS],
                body: 'Drafted a reply confirming interview availability next week.',
                status: 'pending',
            },
            {
                path: '.daemon/pages/reply-3.md',
                slug: 'reply-3',
                title: 'Reply to the book club thread',
                createdAt: new Date(now - 1 * HOUR).toISOString(),
                source: 'cron:answer-emails',
                actions: [APPROVE, DISMISS],
                body: "Drafted a reply with this month's pick.",
                status: 'pending',
            },
        ]
        setTransport(pagesTransport(pages))
        void refreshDaemonPages()
        return <InboxView onOpen={() => {}} />
    },
}
