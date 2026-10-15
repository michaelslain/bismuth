// app/src/InboxPageView.tsx
// Chrome for a `type: daemon-page` note (core/src/daemonPages.ts), read like a terminal
// transcript: a ViewBar on top, then ONE scrolling column — the page title as the subject, the
// page's draft as the first message (a ruled head line over the read-only Editor, which grows to
// fit instead of scrolling itself), every reply and question after it as messages of the same
// shape, then the page's buttons as chips and the `>` reply prompt right under the last message.
// Chrome, not inline markdown: keeps the daemon-authored controls apart from the draft.
import { createEffect, createResource, createSignal, on, Show } from 'solid-js'
import { Editor } from './Editor'
import { api } from './api'
import { pushToast } from './ui/ToastHost'
import ViewBar, { Crumb } from './ui/ViewBar'
import Readout from './ui/Readout'
import InboxActionBar from './InboxActionBar'
import InboxMessageHeader from './InboxMessageHeader'
import InboxThread from './InboxThread'
import Heading from './ui/Heading'
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
            const res = await api.resolveDaemonPage(props.path, actionId)
            if (res.alreadyResolved) pushToast('Already resolved')
            await refreshDaemonPages()
        } catch (e) {
            pushToast(`Couldn't resolve: ${(e as Error).message}`)
        } finally {
            setPressingId(null)
        }
    }

    async function reply(text: string): Promise<void> {
        setPressingId('reply')
        try {
            const res = await api.replyToDaemonPage(props.path, text)
            if (res.alreadyResolved) pushToast('Already resolved')
            await refreshDaemonPages()
        } catch (e) {
            pushToast(`Couldn't send the reply: ${(e as Error).message}`)
        } finally {
            setPressingId(null)
        }
    }

    // A new message lands at the end of the thread: bring it into view, like a mail client does.
    let scroller: HTMLDivElement | undefined
    createEffect(
        on(
            () => page()?.thread?.length ?? 0,
            (n, prev) => {
                if (scroller && n > (prev ?? 0) && prev !== undefined)
                    scroller.scrollTop = scroller.scrollHeight
            },
        ),
    )

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
            <div class={styles['inbox-page-body']} ref={scroller}>
                <Show when={page()?.title}>
                    {t => (
                        <Heading level={1} register="chrome" class={styles.subject}>
                            {t()}
                        </Heading>
                    )}
                </Show>
                <Show when={page()} keyed>
                    {p => <InboxMessageHeader page={p} />}
                </Show>
                <Editor
                    path={props.path}
                    initialText={props.initialText}
                    onSaved={props.onSaved}
                    noteNames={props.noteNames}
                    memoryNames={props.memoryNames}
                    tagNames={props.tagNames}
                    // The subject heads the whole thread above, so the editor shows no title of
                    // its own, and it grows to fit so the replies after it scroll with it. Read-only
                    // like every other message: the draft changes by replying ("make it sunday"),
                    // and the daemon's rewrite reaches the buffer over SSE.
                    hideTitle
                    fitContent
                    readOnly
                    hideFrontmatter
                />
                <Show when={page()?.thread?.length}>
                    <InboxThread
                        class={`${styles.column} ${styles['after-draft']}`}
                        entries={page()?.thread ?? []}
                    />
                </Show>
                <InboxActionBar
                    class={`${styles.column} ${styles.tail} ${page()?.thread?.length ? '' : styles['after-draft']}`}
                    page={page()}
                    notOwner={notOwner()}
                    stuck={stuck()}
                    pressingId={pressingId()}
                    onPress={press}
                    onReply={reply}
                    onMarkFailed={markFailed}
                />
            </div>
        </div>
    )
}
