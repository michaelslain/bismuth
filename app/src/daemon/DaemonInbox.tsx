// app/src/daemon/DaemonInbox.tsx
// The content of the deleted app/src/InboxView.tsx (the former `::inbox` tab), minus its own
// ViewBar — three sections over the pages the daemon has written (core/src/daemonPages.ts):
// Needs review (due, FIFO), Scheduled (future deliverAt, transparency-only), Recently resolved
// (terminal, collapsed, newest-first). `pages` is now a prop, not a module-level signal read
// directly — Task 6's daemon page owns the poll and passes the result down, the same way it
// feeds DaemonServices/DaemonLog. Wrapped in a single shared <DaemonPanel>.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import {
    dueSorted,
    scheduledSorted,
    resolvedSorted,
    sharedPrimaryAction,
} from '../daemonInboxLogic'
import { api } from '../api'
import { pushToast } from '../Toast'
import { TextButton } from '../ui/TextButton'
import EmptyState from '../ui/EmptyState'
import Text from '../ui/Text'
import Badge from '../ui/Badge'
import DaemonPanel from './DaemonPanel'
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
    const scheduled = createMemo(() => scheduledSorted(props.pages, now()))
    const resolved = createMemo(() => resolvedSorted(props.pages))
    const [resolvedOpen, setResolvedOpen] = createSignal(false)

    const approveAllId = createMemo(() => sharedPrimaryAction(due()))

    // Presses run SEQUENTIALLY, never parallel — the daemon multiplexes every vault's brain off
    // one process, so firing a batch of one-shot sessions all at once would just queue behind
    // each other anyway; sequential keeps the UI's per-row state honest as each settles.
    async function approveAll(): Promise<void> {
        const actionId = approveAllId()
        if (!actionId) return
        for (const p of due()) {
            try {
                await api.resolveDaemonPage(p.path, actionId)
            } catch (e) {
                pushToast(
                    `Couldn't resolve "${p.title}": ${(e as Error).message}`,
                )
            }
        }
        props.onChanged()
    }

    return (
        <DaemonPanel
            title="inbox"
            // DUE pages only — the same count as the ViewBar's `N in inbox` readout and the
            // toolbar badge (daemonInbox.ts dueCount), never scheduled or resolved ones.
            count={due().length}
            class={props.class}
        >
            <Show
                when={
                    due().length === 0 &&
                    scheduled().length === 0 &&
                    resolved().length === 0
                }
            >
                <EmptyState>nothing needs you</EmptyState>
            </Show>

            <Show when={due().length > 0}>
                <div class={styles['inbox-section-head']}>
                    <Text as="div" eyebrow size="micro" tone="faint">
                        Needs review{' '}
                        <Badge class={styles['inbox-section-count']}>
                            {due().length}
                        </Badge>
                    </Text>
                    <Show when={approveAllId()}>
                        {/* PRIMARY. This commits every drafted AI reply in the section at
                            once — the highest-stakes action in the panel. */}
                        <TextButton
                            size="sm"
                            primary
                            onClick={approveAll}
                            style={{ 'margin-left': 'auto' }}
                        >
                            APPROVE ALL
                        </TextButton>
                    </Show>
                </div>
                <For each={due()}>
                    {p => (
                        <InboxRow
                            page={p}
                            onOpen={props.onOpen}
                            showActions
                            onChanged={props.onChanged}
                        />
                    )}
                </For>
            </Show>

            <Show when={scheduled().length > 0}>
                <div class={styles['inbox-section-head']}>
                    <Text as="div" eyebrow size="micro" tone="faint">
                        Scheduled{' '}
                        <Badge class={styles['inbox-section-count']}>
                            {scheduled().length}
                        </Badge>
                    </Text>
                </div>
                <For each={scheduled()}>
                    {p => (
                        <InboxRow
                            page={p}
                            onOpen={props.onOpen}
                            showActions={false}
                            onChanged={props.onChanged}
                        />
                    )}
                </For>
            </Show>

            <Show when={resolved().length > 0}>
                <div
                    class={`${styles['inbox-section-head']} ${styles['inbox-section-head-collapsible']}`}
                    onClick={() => setResolvedOpen(v => !v)}
                >
                    <Text as="div" eyebrow size="micro" tone="faint">
                        Recently resolved{' '}
                        <Badge class={styles['inbox-section-count']}>
                            {resolved().length}
                        </Badge>
                    </Text>
                    <span class={styles['inbox-section-toggle']}>
                        {resolvedOpen() ? 'hide' : 'show'}
                    </span>
                </div>
                <Show when={resolvedOpen()}>
                    <For each={resolved()}>
                        {p => (
                            <InboxRow
                                page={p}
                                onOpen={props.onOpen}
                                showActions={false}
                                onChanged={props.onChanged}
                            />
                        )}
                    </For>
                </Show>
            </Show>
        </DaemonPanel>
    )
}

export default DaemonInbox
