// Visual spec for <InboxPageView> — the action bar PINNED TO THE BOTTOM of a `type:
// daemon-page` note's editor: the page's actions[] as buttons, or a status chip/owner
// warning once there's nothing left to press. The Editor body fills the space above and
// scrolls on its own; the bar stays put under it. Like InboxView, `page()` is looked up by
// `path` in the SAME module-level daemonInbox.ts signal — populated the same way here (a
// scoped GET /daemon/pages route + refreshDaemonPages() called inside each story's render).
//
// The body below the header is the REAL Editor.tsx (CodeMirror), mounted with `initialText` so
// it never needs to fetch the file itself. `api.daemonStatus()` (GET /daemon/status, used for
// the "not the owner device" warning) falls through `pagesTransport()` to `fakeTransport()`'s
// own default stub, which carries `owner: null` — the "no owner assigned" state `notOwner()`
// is meant to handle.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { InboxPageView } from './InboxPageView'
import { refreshDaemonPages } from './daemonInbox'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import { sampleDaemonPages } from './ui/_daemonFixtures'
import type { Transport } from './api'

/** The two page bodies, hoisted so the fakeTransport SEED and the `initialText` prop are the
 *  same string. They must match: Editor's mount-time SSE-reconcile effect re-reads
 *  `GET /file?path=…`, and an UNSEEDED fakeTransport answers a missing path with `""` — which the
 *  effect takes for a real external edit and reconciles the buffer down to empty milliseconds
 *  after mount, leaving only the note-title widget over a blank body. Seeding the same text at
 *  the same path makes `current === onDisk`, so the reconcile is the no-op every real caller gets
 *  for free (real callers always pass already-fetched disk content). Editor.stories.tsx's
 *  `Default` documents the same trap and seeds itself the same way. */
const REPLY_DRAFTS_PATH = '.daemon/pages/reply-drafts.md'
const GCAL_SYNC_PATH = '.daemon/pages/gcal-sync.md'

/* THE FILE AS IT ACTUALLY EXISTS ON DISK — frontmatter, then a PLAIN body. These used to open
   with a `# 3 reply drafts ready` heading, which no real page carries: createDaemonPage()
   (core/src/daemonPages.ts) stamps the title into FRONTMATTER and writes the caller's body
   verbatim beneath it, and the fixture agrees (ui/_daemonFixtures.ts keeps `title` and `body` as
   separate fields, the body headingless). The invented H1 duplicated the note-title widget the
   editor already renders from the filename, so the story showed two stacked headings the product
   never shows — a visual spec disagreeing with the thing it specifies. */
const REPLY_DRAFTS_TEXT = `---
type: daemon-page
title: 3 reply drafts ready
source: cron:answer-emails
---

Drafted replies to 3 unread emails from the last hour. Review before sending.
`
const GCAL_SYNC_TEXT = `---
type: daemon-page
title: Calendar sync failed
source: cron:gcal-sync
---

Google Calendar sync failed: token expired.
`

const PAGE_FILES = {
    [REPLY_DRAFTS_PATH]: REPLY_DRAFTS_TEXT,
    [GCAL_SYNC_PATH]: GCAL_SYNC_TEXT,
}

function pagesTransport(): Transport {
    const base = fakeTransport({ files: PAGE_FILES })
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/daemon/pages')
                return sampleDaemonPages() as unknown as T
            return base.getJson<T>(path)
        },
    }
}

// Poses the exact `/daemon/status` shape that used to CRASH this view: no `owner` key at all
// (not even `owner: null`) — the shape a real response would have BEFORE the daemon has ever
// picked an owner. `notOwner()`'s old guard read `s.owner !== null`, which is true for
// `undefined`, so it walked into `s.owner.ownerDeviceId` and threw.
function statusWithoutOwnerTransport(): Transport {
    const base = fakeTransport({ files: PAGE_FILES })
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/daemon/pages')
                return sampleDaemonPages() as unknown as T
            if (path === '/daemon/status')
                return {
                    enabled: true,
                    running: true,
                    crons: [],
                    processes: [],
                } as unknown as T
            return base.getJson<T>(path)
        },
    }
}

const meta = {
    title: 'App/InboxPageView',
    component: InboxPageView,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof InboxPageView>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** A sized stand-in for a real editor pane, at a given width — InboxPageView is `height: 100%`,
 *  so a narrower-pane story needs a bounded box or the width the assertion cares about never
 *  takes effect (copy of the pattern in bases/FlashcardsView.stories.tsx). */
function Pane(props: { w: string; children: any }) {
    return (
        <div
            style={{
                width: props.w,
                height: '640px',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {props.children}
        </div>
    )
}

/** The action bar's [submit] left edge must equal the note text column's left edge
 *  (`.cm-content`'s left, within 2px) — the bar's CONTENT shares the editor's centred reading
 *  column (`--note-column`) instead of sitting at the pane's left edge. The bar's own top
 *  hairline still spans the full pane width — asserted separately below. */
async function assertActionsAlignToText(canvasElement: HTMLElement) {
    const content = canvasElement.querySelector('.cm-content')
    const bar = canvasElement.querySelector(
        '[data-testid="inbox-page-actions"]',
    )
    const submit = bar?.querySelector('button') ?? null
    await expect(content).not.toBeNull()
    await expect(bar).not.toBeNull()
    await expect(submit).not.toBeNull()
    const contentLeft = (content as HTMLElement).getBoundingClientRect().left
    const submitLeft = (submit as HTMLElement).getBoundingClientRect().left
    await expect(Math.abs(submitLeft - contentLeft)).toBeLessThanOrEqual(2)
    // The bar's own top hairline still spans the full pane — its rect, not its inner row, is as
    // wide as the pane host that contains both it and the editor body.
    const barRect = (bar as HTMLElement).getBoundingClientRect()
    const host = (bar as HTMLElement).parentElement as HTMLElement
    const hostRect = host.getBoundingClientRect()
    await expect(barRect.left).toBeCloseTo(hostRect.left, 0)
    await expect(barRect.width).toBeCloseTo(hostRect.width, 0)
}

/** A pending page: two live actions ("Submit" / "Dismiss") in the bar pinned to the bottom. */
export const Pending: Story = {
    render: () => {
        setTransport(pagesTransport())
        void refreshDaemonPages()
        return (
            <InboxPageView
                path={REPLY_DRAFTS_PATH}
                initialText={REPLY_DRAFTS_TEXT}
                onSaved={noop}
                noteNames={() => []}
                memoryNames={() => []}
                tagNames={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        // The bar sits BELOW the editor body, not above it — buttons at the bottom of the pane,
        // text above. `.cm-editor` is CodeMirror's own unhashed class (never a project module),
        // safe to query directly as the body's real top edge.
        const body = canvasElement.querySelector('.cm-editor')
        const bar = canvasElement.querySelector(
            '[data-testid="inbox-page-actions"]',
        )
        await expect(body).not.toBeNull()
        await expect(bar).not.toBeNull()
        const bodyTop = (body as HTMLElement).getBoundingClientRect().top
        const barTop = (bar as HTMLElement).getBoundingClientRect().top
        await expect(barTop).toBeGreaterThan(bodyTop)
        await assertActionsAlignToText(canvasElement)
    },
}

/** Same as `Pending`, at a 900px pane width — the bar's content must still track the editor's
 *  centred column once it narrows, not just at the default (1280px) viewport. */
export const PendingNarrowPane: Story = {
    render: () => {
        setTransport(pagesTransport())
        void refreshDaemonPages()
        return (
            <Pane w="900px">
                <InboxPageView
                    path={REPLY_DRAFTS_PATH}
                    initialText={REPLY_DRAFTS_TEXT}
                    onSaved={noop}
                    noteNames={() => []}
                    memoryNames={() => []}
                    tagNames={() => []}
                />
            </Pane>
        )
    },
    play: async ({ canvasElement }) => {
        await assertActionsAlignToText(canvasElement)
    },
}

/** A failed page: the danger note plus its still-live retry action. */
export const Failed: Story = {
    render: () => {
        setTransport(pagesTransport())
        void refreshDaemonPages()
        return (
            <InboxPageView
                path={GCAL_SYNC_PATH}
                initialText={GCAL_SYNC_TEXT}
                onSaved={noop}
                noteNames={() => []}
                memoryNames={() => []}
                tagNames={() => []}
            />
        )
    },
}

/** The `/daemon/status` shape that used to CRASH this view: no `owner` key at all. The guard
 *  read `s.owner !== null`, which is true for `undefined`, so it walked into
 *  `s.owner.ownerDeviceId`. This story exists to fail if that strictness ever returns. */
export const StatusWithoutOwner: Story = {
    render: () => {
        setTransport(statusWithoutOwnerTransport())
        void refreshDaemonPages()
        return (
            <InboxPageView
                path={REPLY_DRAFTS_PATH}
                initialText={REPLY_DRAFTS_TEXT}
                onSaved={noop}
                noteNames={() => []}
                memoryNames={() => []}
                tagNames={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        // Rendering AT ALL is the assertion — this threw before the fix.
        await expect(canvasElement.querySelector('*')).not.toBeNull()
        await expect(canvasElement.textContent || '').not.toMatch(
            /ownerDeviceId/,
        )
    },
}
