// app/src/daemon/DaemonInbox.tsx
// The content of the deleted app/src/InboxView.tsx (the former `::inbox` tab), minus its own
// ViewBar — four sections over the pages the daemon has written (core/src/daemonPages.ts):
// Needs review (due, FIFO), Failed (retryable, newest first), Scheduled (future deliverAt,
// transparency-only), Recently resolved (done/dismissed, collapsed, newest-first). `pages` is a
// prop — the daemon page owns the poll and passes the result down, the same way it feeds
// DaemonServices/DaemonLog. Wrapped in a single shared <DaemonPanel>.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import {
    dueSorted,
    failedSorted,
    scheduledSorted,
    resolvedSorted,
    sharedPrimaryAction,
} from '../daemonInboxLogic'
import { api } from '../api'
import { pushToast } from '../Toast'
import { TextButton } from '../ui/TextButton'
import PlainButton from '../ui/PlainButton'
import EmptyState from '../ui/EmptyState'
import Text from '../ui/Text'
import Badge from '../ui/Badge'
import { isDismissKey } from '../ui/widgetKeys'
import DaemonPanel, { daemonPanelEmptyClass } from './DaemonPanel'
import InboxRow from './InboxRow'
import styles from './DaemonInbox.module.css'

export type DaemonInboxProps = {
    pages: DaemonPage[]
    onOpen: (path: string) => void
    onChanged: () => void
    class?: string
}

function DaemonInbox(props: DaemonInboxProps) {
    const now = () => Date.now()
    const due = createMemo(() => dueSorted(props.pages, now()))
    const failed = createMemo(() => failedSorted(props.pages))
    const scheduled = createMemo(() => scheduledSorted(props.pages, now()))
    const resolved = createMemo(() => resolvedSorted(props.pages))
    const [resolvedOpen, setResolvedOpen] = createSignal(false)

    const approveAllId = createMemo(() => sharedPrimaryAction(due()))
    // Approve-all makes the daemon ACT once per page and cannot be undone, so it takes two
    // presses: the first swaps the button for a confirm that names the count.
    const [confirming, setConfirming] = createSignal(false)
    const [approving, setApproving] = createSignal(false)
    let cancelRef: HTMLButtonElement | undefined

    function askConfirm(): void {
        setConfirming(true)
        // Focus lands on the safe choice, so a stray Enter backs out rather than committing.
        queueMicrotask(() => cancelRef?.focus())
    }

    // Presses run SEQUENTIALLY, never parallel — the daemon multiplexes every vault's brain off
    // one process, so firing a batch of one-shot sessions all at once would just queue behind
    // each other anyway; sequential keeps the UI's per-row state honest as each settles.
    async function approveAll(): Promise<void> {
        const actionId = approveAllId()
        if (!actionId || approving()) return
        const pages = due()
        setApproving(true)
        let ok = 0
        for (const p of pages) {
            try {
                await api.resolveDaemonPage(p.path, actionId)
                ok++
            } catch (e) {
                pushToast(
                    `Couldn't resolve "${p.title}": ${(e as Error).message}`,
                )
            }
        }
        setApproving(false)
        setConfirming(false)
        if (ok > 0)
            pushToast(
                ok === pages.length
                    ? `Approved ${ok}`
                    : `Approved ${ok} of ${pages.length}`,
            )
        props.onChanged()
    }

    const rows = (pages: DaemonPage[], showActions: boolean) => (
        <For each={pages}>
            {p => (
                <InboxRow
                    page={p}
                    onOpen={props.onOpen}
                    showActions={showActions}
                    onChanged={props.onChanged}
                />
            )}
        </For>
    )

    const sectionTitle = (title: string, count: number) => (
        <Text as="div" eyebrow size="micro" tone="faint">
            {title}{' '}
            <Badge class={styles['inbox-section-count']}>{count}</Badge>
        </Text>
    )

    return (
        <DaemonPanel
            // No title/count — the ViewBar facet (`inbox N`) is this panel's heading now.
            // Acceptance: "no dead space under the last item — the panel packs to content like
            // the crons/services panels." DaemonPanel's own `packToContent` (DaemonPanel.tsx) —
            // sizes to its rows instead of stretching to fill the grid cell.
            packToContent
            class={`${styles['inbox-panel']} ${props.class ?? ''}`}
        >
            <Show
                when={
                    due().length === 0 &&
                    failed().length === 0 &&
                    scheduled().length === 0 &&
                    resolved().length === 0
                }
            >
                <EmptyState blockClass={daemonPanelEmptyClass}>nothing needs you</EmptyState>
            </Show>

            <Show when={due().length > 0}>
                <div
                    class={styles['inbox-section-head']}
                    onKeyDown={e => {
                        if (confirming() && isDismissKey(e)) {
                            e.stopPropagation()
                            setConfirming(false)
                        }
                    }}
                >
                    {sectionTitle('Needs review', due().length)}
                    <Show when={approveAllId()}>
                        <div class={styles['inbox-section-actions']}>
                            <Show
                                when={confirming()}
                                fallback={
                                    <TextButton
                                        primary
                                        onClick={askConfirm}
                                    >
                                        {`approve all ${due().length}`}
                                    </TextButton>
                                }
                            >
                                <TextButton
                                    ref={cancelRef}
                                    disabled={approving()}
                                    onClick={() => setConfirming(false)}
                                >
                                    cancel
                                </TextButton>
                                <TextButton
                                    primary
                                    disabled={approving()}
                                    aria-busy={approving()}
                                    onClick={approveAll}
                                >
                                    {approving()
                                        ? '…'
                                        : `confirm ${due().length}`}
                                </TextButton>
                            </Show>
                        </div>
                    </Show>
                </div>
                <Show when={confirming()}>
                    <Text
                        as="p"
                        size="ui"
                        tone="muted"
                        role="status"
                        class={styles['inbox-confirm-note']}
                    >
                        The daemon will act on all {due().length}. This can't be
                        undone.
                    </Text>
                </Show>
                {rows(due(), true)}
            </Show>

            <Show when={failed().length > 0}>
                <div class={styles['inbox-section-head']}>
                    {sectionTitle('Failed', failed().length)}
                </div>
                {rows(failed(), true)}
            </Show>

            <Show when={scheduled().length > 0}>
                <div class={styles['inbox-section-head']}>
                    {sectionTitle('Scheduled', scheduled().length)}
                </div>
                {rows(scheduled(), false)}
            </Show>

            <Show when={resolved().length > 0}>
                <PlainButton
                    class={styles['inbox-section-head']}
                    aria-expanded={resolvedOpen()}
                    onClick={() => setResolvedOpen(v => !v)}
                >
                    {sectionTitle('Recently resolved', resolved().length)}
                    <Text
                        as="span"
                        size="micro"
                        tone="muted"
                        class={styles['inbox-section-toggle']}
                    >
                        {resolvedOpen() ? 'hide' : 'show'}
                    </Text>
                </PlainButton>
                <Show when={resolvedOpen()}>{rows(resolved(), false)}</Show>
            </Show>
        </DaemonPanel>
    )
}

export default DaemonInbox
