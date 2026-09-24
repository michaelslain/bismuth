// app/src/daemon/DaemonInbox.tsx
// The content of the deleted app/src/InboxView.tsx (the former `::inbox` tab), now a flat list
// over the pages the daemon has written (core/src/daemonPages.ts): due, failed, then scheduled —
// each group's existing sort, concatenated with no group headings (the daemon page's own
// `DaemonSection` heading is the only heading now). Recently resolved (done/dismissed) stays
// collapsed behind a trailing `N resolved // show` toggle. `pages` is a prop — the daemon page
// owns the poll and passes the result down, the same way it feeds DaemonProcesses/DaemonLog.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import {
    dueSorted,
    failedSorted,
    scheduledSorted,
    resolvedSorted,
} from '../daemonInboxLogic'
import PlainButton from '../ui/PlainButton'
import Text from '../ui/Text'
import DaemonSection from './DaemonSection'
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
    const open = createMemo(() => [...due(), ...failed(), ...scheduled()])
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

    return (
        <DaemonSection
            title="inbox"
            count={open().length}
            empty="nothing needs you"
            isEmpty={open().length === 0}
            class={props.class}
        >
            {rows(open())}
            <Show when={resolved().length > 0}>
                <PlainButton
                    class={styles['resolved-toggle']}
                    aria-expanded={resolvedOpen()}
                    onClick={() => setResolvedOpen(v => !v)}
                >
                    <Text as="span" size="ui" tone="faint">
                        {`${resolved().length} resolved // `}
                    </Text>
                    <Text as="span" size="ui" tone="muted">
                        {resolvedOpen() ? 'hide' : 'show'}
                    </Text>
                </PlainButton>
                <Show when={resolvedOpen()}>{rows(resolved())}</Show>
            </Show>
        </DaemonSection>
    )
}

export default DaemonInbox
