// app/src/daemon/DaemonInbox.tsx
// The content of the deleted app/src/InboxView.tsx (the former `::inbox` tab), minus its own
// ViewBar — four sections over the pages the daemon has written (core/src/daemonPages.ts):
// Needs review (due, FIFO), Failed (retryable, newest first), Scheduled (future deliverAt,
// transparency-only), Recently resolved (done/dismissed, collapsed, newest-first). `pages` is a
// prop — the daemon page owns the poll and passes the result down, the same way it feeds
// DaemonProcesses/DaemonLog. Wrapped in a single shared <DaemonPanel>.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import {
    dueSorted,
    failedSorted,
    scheduledSorted,
    resolvedSorted,
} from '../daemonInboxLogic'
import PlainButton from '../ui/PlainButton'
import EmptyState from '../ui/EmptyState'
import Text from '../ui/Text'
import Badge from '../ui/Badge'
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

    const rows = (pages: DaemonPage[]) => (
        <For each={pages}>
            {p => (
                <InboxRow
                    page={p}
                    onOpen={props.onOpen}
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
                <div class={styles['inbox-section-head']}>
                    {sectionTitle('Needs review', due().length)}
                </div>
                {rows(due())}
            </Show>

            <Show when={failed().length > 0}>
                <div class={styles['inbox-section-head']}>
                    {sectionTitle('Failed', failed().length)}
                </div>
                {rows(failed())}
            </Show>

            <Show when={scheduled().length > 0}>
                <div class={styles['inbox-section-head']}>
                    {sectionTitle('Scheduled', scheduled().length)}
                </div>
                {rows(scheduled())}
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
                <Show when={resolvedOpen()}>{rows(resolved())}</Show>
            </Show>
        </DaemonPanel>
    )
}

export default DaemonInbox
