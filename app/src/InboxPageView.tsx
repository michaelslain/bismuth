// app/src/InboxPageView.tsx
// Chrome for a `type: daemon-page` note (core/src/daemonPages.ts): a ViewBar identity header on
// top, the Editor body filling the space between (scrolls on its own), and an action bar — the
// page's actions[] as buttons, or a status phrase once there's nothing left to press
// — PINNED to the bottom of the pane, always visible regardless of scroll position. Chrome, not
// inline markdown: keeps the daemon-authored controls physically separate from the user's
// editable prose.
import { createResource, createSignal, Show } from 'solid-js'
import { Editor } from './Editor'
import { api } from './api'
import { flushEditorByPath } from './editorRegistry'
import { pushToast } from './ui/ToastHost'
import ViewBar, { Crumb } from './ui/ViewBar'
import Readout from './ui/Readout'
import InboxActionBar from './InboxActionBar'
import { inboxPageReadouts } from './inboxPageMeta'
import { inboxPages, refreshDaemonPages } from './daemon/daemonInboxApi'
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'
import Text from './ui/Text'
import styles from './InboxPageView.module.css'

// A page reading "working" for longer than this is presumed stuck (the daemon process itself
// died mid-run, no writer left to ever settle it) — plan §5's belt-and-suspenders client check.
const STUCK_WORKING_MS = 10 * 60 * 1000

export function InboxPageView(props: {
    path: string
    initialText?: string
    onSaved: () => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
}) {
    // The live page record (actions/status) comes from the shared poll (daemonInbox.ts), which
    // App.tsx keeps running whenever the daemon is enabled — this just looks up OUR path in it.
    const page = () => inboxPages().find(p => p.path === props.path)
    const [pressingId, setPressingId] = createSignal<string | null>(null)

    // Am I the owner device? Approving a page on a non-owner device would silently do nothing
    // (the daemon consumes the trigger without firing) — surface that instead of letting the user
    // wonder why "Send" appeared to work. Fetched once per mount, like DaemonSetupModal does.
    const [status] = createResource(() => api.daemonStatus())
    const notOwner = () => {
        const s = status()
        // `!= null` (loose) ON PURPOSE: it catches BOTH null and undefined. The strict `!== null`
        // this replaced let `undefined` through — `undefined !== null` is true — so a /daemon/status
        // response without an `owner` key walked straight into `s.owner.ownerDeviceId` and threw.
        // That is reachable in the shipped app, not only in stories.
        return !!s && s.owner != null && s.owner.ownerDeviceId !== s.thisDeviceId
    }

    const stuck = () => {
        const p = page()
        if (!p || p.status !== 'working' || !p.pressedAt) return false
        return Date.now() - Date.parse(p.pressedAt) > STUCK_WORKING_MS
    }

    async function press(actionId: string): Promise<void> {
        setPressingId(actionId)
        try {
            // Flush THIS page's buffer to disk FIRST, so the daemon acts on exactly what's on
            // screen — not a stale, still-debounced autosave. Scoped by path: in a split layout the
            // last-focused view can be a DIFFERENT note, so a focused-editor flush would persist the
            // wrong buffer and skip this one.
            await flushEditorByPath(props.path)
            const res = await api.resolveDaemonPage(props.path, actionId)
            if (res.alreadyResolved) pushToast('Already resolved')
            await refreshDaemonPages()
        } catch (e) {
            pushToast(`Couldn't resolve: ${(e as Error).message}`)
        } finally {
            setPressingId(null)
        }
    }

    async function markFailed(): Promise<void> {
        try {
            await api.markDaemonPageFailed(props.path)
            await refreshDaemonPages()
        } catch (e) {
            // The escape hatch itself needs an escape hatch: with the backend unreachable a silent
            // no-op looks like the button is broken. Say what happened.
            pushToast(`Couldn't mark failed: ${(e as Error).message}`)
        }
    }

    return (
        <div class={styles['inbox-page-host']}>
            <ViewBar
                identity={<Crumb icon="Inbox">daemon</Crumb>}
                locus={
                    <>
                        <Text as="span" size="ui" tone="faint">
                            /
                        </Text>
                        <Text as="span" size="ui">
                            inbox
                        </Text>
                    </>
                }
                readouts={
                    <Show when={page()} keyed>
                        {p => <Readout parts={inboxPageReadouts(p)} />}
                    </Show>
                }
            />
            <div class={styles['inbox-page-body']}>
                <Editor
                    path={props.path}
                    initialText={props.initialText}
                    onSaved={props.onSaved}
                    noteNames={props.noteNames}
                    memoryNames={props.memoryNames}
                    tagNames={props.tagNames}
                    // THE SUBJECT LINE. Without this the heading falls back to the
                    // filename, which for a daemon page is a slug — so the inbox row read
                    // "3 reply drafts ready" and the page you landed on read
                    // "reply-drafts". Same page, two names. `page()?.title` is the exact
                    // field the inbox row renders, so the list and the page now agree.
                    // Passed as an accessor because `page()` comes from a poll that can
                    // settle after this mounts. READ-ONLY because the daemon owns the
                    // title: it lives in the file's frontmatter, and the editable title
                    // renames the FILE, which would desync the slug from the frontmatter
                    // and break the daemon's own lookup by path.
                    title={() => page()?.title}
                    titleReadOnly
                    hideFrontmatter
                />
            </div>
            <InboxActionBar
                page={page()}
                notOwner={notOwner()}
                stuck={stuck()}
                pressingId={pressingId()}
                onPress={press}
                onMarkFailed={markFailed}
            />
        </div>
    )
}
