// Visual spec for <InboxPageView> — the action bar PINNED TO THE BOTTOM of a `type:
// daemon-page` note's editor: the page's actions[] as buttons, or a status phrase/owner
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
import { expect, userEvent, waitFor } from 'storybook/test'
import { InboxPageView } from './InboxPageView'
import { refreshDaemonPages } from './daemon/daemonInboxApi'
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

const DREAM_PATH = '.daemon/pages/dream-consolidation.md'
const DREAM_TEXT = `---
type: daemon-page
title: Memory consolidation complete
source: cron:dream
---

Consolidated 14 memory notes into 3 themes.
`
// A page file with NO frontmatter at all — the body must show whole.
const VAULT_REVIEW_PATH = '.daemon/pages/vault-review.md'
const NO_FRONTMATTER_TEXT = `Summarizing new and edited notes from the last 7 days.

type: this line is body text, not frontmatter
`

const PAGE_FILES = {
    [DREAM_PATH]: DREAM_TEXT,
    [VAULT_REVIEW_PATH]: NO_FRONTMATTER_TEXT,
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

/** A transport whose inbox REMEMBERS a reply, the way core's replyToPage does: POST
 *  /daemon/pages/reply puts the reply in the page's thread and the page reads `working` +
 *  `replying` until the daemon answers. Storybook has no daemon, so the page stays there — which is
 *  exactly what the app shows while the daemon reads. `thread` seeds an earlier exchange. */
function replyTransport(thread: unknown[] = []): Transport {
    const base = fakeTransport({ files: PAGE_FILES })
    const pages = sampleDaemonPages().map(p =>
        p.path === REPLY_DRAFTS_PATH ? { ...p, thread: thread as never[] } : p,
    )
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/daemon/pages') return structuredClone(pages) as unknown as T
            return base.getJson<T>(path)
        },
        postJson: async <T,>(path: string, body: unknown): Promise<T> => {
            if (path === '/daemon/pages/reply') {
                const { path: pagePath, text } = body as { path: string; text: string }
                const page = pages.find(p => p.path === pagePath)!
                const at = new Date().toISOString()
                page.status = 'working'
                page.replying = true
                page.pressedAt = at
                page.thread = [...(page.thread ?? []), { from: 'you', text, at, via: 'app' }]
                return { status: 'working', alreadyResolved: false } as unknown as T
            }
            return base.postJson<T>(path, body)
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

/** The reply prompt and the draft's head line must start where the body text starts (its first
 *  glyph, within 2px) — everything shares the editor's centred reading column (`--note-column`)
 *  — and the prompt must follow the draft directly, with no pinned-dock gap. */
async function assertActionsAlignToText(canvasElement: HTMLElement) {
    const content = canvasElement.querySelector('.cm-content')
    const bar = canvasElement.querySelector(
        '[data-testid="inbox-page-actions"]',
    )
    const lead = await waitFor(() => {
        const el = canvasElement.querySelector('[data-testid="inbox-composer"]')
        expect(el).not.toBeNull()
        return el
    })
    const fromKey = canvasElement.querySelector('[data-testid="inbox-message-header"] > div')
    await expect(content).not.toBeNull()
    await expect(bar).not.toBeNull()
    await expect(lead).not.toBeNull()
    // Where the body TEXT starts, not `.cm-content`'s box: CodeMirror pads each `.cm-line` on
    // its leading edge, so the box sits a few px left of the first glyph a reader lines things up
    // against.
    const contentLeft = await waitFor(() => {
        for (const line of (content as HTMLElement).querySelectorAll('.cm-line')) {
            if (!line.textContent?.trim()) continue
            const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
            const n = walk.nextNode()
            if (!n) continue
            const r = document.createRange()
            r.setStart(n, 0)
            r.setEnd(n, 1)
            return r.getBoundingClientRect().left
        }
        throw new Error('no body text yet')
    })
    const leadLeft = (lead as HTMLElement).getBoundingClientRect().left
    await expect(Math.abs(leadLeft - contentLeft)).toBeLessThanOrEqual(2)
    await expect(fromKey).not.toBeNull()
    const keyLeft = (fromKey as HTMLElement).getBoundingClientRect().left
    await expect(Math.abs(keyLeft - contentLeft)).toBeLessThanOrEqual(2)
    // No dead space: the prompt follows the draft directly, not pinned to the pane's bottom.
    const draftLine = [...canvasElement.querySelectorAll('.cm-line')]
        .filter(l => l.textContent?.trim())
        .at(-1) as HTMLElement
    const gap = (lead as HTMLElement).getBoundingClientRect().top - draftLine.getBoundingClientRect().bottom
    await expect(gap).toBeLessThan(120)
}

/** The frontmatter block must be hidden from the editor's rendered text. */
async function assertFrontmatterHidden(canvasElement: HTMLElement) {
    await waitFor(() => {
        const t = canvasElement.querySelector('.cm-content')?.textContent
        expect(t).toBeTruthy()
        expect(t).not.toMatch(/type: daemon-page|source:|^---/)
    })
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
        await assertFrontmatterHidden(canvasElement)
        // The draft is read-only like every other message; it changes by replying.
        await expect(
            canvasElement.querySelector('.cm-content')?.getAttribute('contenteditable'),
        ).toBe('false')
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
    play: async ({ canvasElement }) => {
        await assertFrontmatterHidden(canvasElement)
    },
}

/** Answer a page in your own words: type in the bar's field and press Enter. The page switches to
 *  `reading your reply…` and the buttons step aside while the daemon reads it. */
export const ReplyInWords: Story = {
    render: () => {
        setTransport(replyTransport())
        void refreshDaemonPages()
        return (
            <Pane w="100%">
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
        const field = await waitFor(() => {
            const f = canvasElement.querySelector<HTMLInputElement>(
                '[data-testid="inbox-reply-input"]',
            )
            expect(f).not.toBeNull()
            return f!
        })
        await expect(field.placeholder).toBe('reply in your own words')
    },
}

/** The same page after a reply was sent: what the bar shows while the daemon reads it. */
export const ReplySent: Story = {
    render: ReplyInWords.render,
    play: async ({ canvasElement }) => {
        const field = await waitFor(() => {
            const f = canvasElement.querySelector<HTMLInputElement>(
                '[data-testid="inbox-reply-input"]',
            )
            expect(f).not.toBeNull()
            return f!
        })
        await userEvent.type(field, 'send the first two, hold the one to Sam{Enter}')
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="inbox-page-actions"]')?.textContent,
            ).toMatch(/reading your reply…/),
        )
    },
}

/** The daemon could not tell what a reply meant and asked back: the thread shows your reply and
 *  its question over the compose box, and the next reply answers it. */
export const AskingBack: Story = {
    render: () => {
        const at = new Date().toISOString()
        setTransport(
            replyTransport([
                { from: 'you', text: 'maybe hold the one to Sam', at, via: 'app' },
                {
                    from: 'daemon',
                    text: 'Send the other two now and keep the reply to Sam as a draft?',
                    at,
                },
            ]),
        )
        void refreshDaemonPages()
        return (
            <Pane w="100%">
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
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="inbox-thread"] li[data-from="daemon"]')
                    ?.textContent,
            ).toMatch(/keep the reply to Sam as a draft\?/),
        )
        // One rhythm: the gap from the draft's last line to the first reply's head matches the gap
        // from that reply's words to the next head.
        const heads = [...canvasElement.querySelectorAll('[data-testid="inbox-thread"] li')]
        const draftLine = [...canvasElement.querySelectorAll('.cm-line')]
            .filter(l => l.textContent?.trim())
            .at(-1) as HTMLElement
        const top = (el: Element) => el.getBoundingClientRect().top
        const bottom = (el: Element) => el.getBoundingClientRect().bottom
        const head = (li: Element) => li.firstElementChild!
        const afterDraft = top(head(heads[0])) - bottom(draftLine)
        const afterReply = top(head(heads[1])) - bottom(heads[0].lastElementChild!)
        await expect(Math.abs(afterDraft - afterReply)).toBeLessThanOrEqual(4)
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

/** A done page: the `done // <note>` phrase, no buttons. */
export const Done: Story = {
    render: () => {
        setTransport(pagesTransport())
        void refreshDaemonPages()
        return (
            <InboxPageView
                path={DREAM_PATH}
                initialText={DREAM_TEXT}
                onSaved={noop}
                noteNames={() => []}
                memoryNames={() => []}
                tagNames={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await assertFrontmatterHidden(canvasElement)
        // The status line follows the draft and paints above the editor's empty last row; under
        // it, the editor's ground would hide it.
        const status = await waitFor(() => {
            const el = canvasElement.querySelector('[data-testid="inbox-page-status"]')
            expect(el).not.toBeNull()
            return el as HTMLElement
        })
        const r = status.getBoundingClientRect()
        const hit = document.elementFromPoint(r.left + 20, r.top + r.height / 2)
        await expect(status.contains(hit)).toBe(true)
    },
}

/** A page file with no frontmatter: nothing to hide, the body shows intact. */
export const NoFrontmatter: Story = {
    render: () => {
        setTransport(pagesTransport())
        void refreshDaemonPages()
        return (
            <InboxPageView
                path={VAULT_REVIEW_PATH}
                initialText={NO_FRONTMATTER_TEXT}
                onSaved={noop}
                noteNames={() => []}
                memoryNames={() => []}
                tagNames={() => []}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent || '').toMatch(
            /Summarizing new and edited notes/,
        )
        await expect(
            canvasElement.querySelector('.cm-content')!.textContent,
        ).toMatch(/type: this line is body text/)
    },
}
