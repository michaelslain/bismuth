// app/src/daemon/DaemonInbox.tsx
// The content of the deleted app/src/InboxView.tsx (the former `::inbox` tab), now a flat list
// over the pages the daemon has written (core/src/daemonPages.ts): due, failed, then scheduled —
// each group's existing sort, concatenated with no group headings (the daemon page's own
// `DaemonSection` heading is the only heading now). Recently resolved (done/dismissed) stays
// collapsed behind a trailing `N resolved // show` toggle. `pages` is a prop — the daemon page
// owns the poll and passes the result down, the same way it feeds DaemonProcesses/DaemonLog.
// `limit` row-caps the OPEN rows only (due/failed/scheduled are already attention-first, so a
// limit never hides a problem) behind a `+N more // show` line; resolved rows stay behind their
// own toggle regardless.
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import {
    dueSorted,
    failedSorted,
    scheduledSorted,
    resolvedSorted,
} from '../daemonInboxLogic'
import DaemonSection from './DaemonSection'
import DaemonMoreLine from './DaemonMoreLine'
import InboxRow from './InboxRow'
import type { RowLimit } from './daemonRowBudget'

export type DaemonInboxProps = {
    pages: DaemonPage[]
    onOpen: (path: string) => void
    onChanged: () => void
    limit?: RowLimit
    class?: string
}

function DaemonInbox(props: DaemonInboxProps) {
    const now = () => Date.now()
    const due = createMemo(() => dueSorted(props.pages, now()))
    const failed = createMemo(() => failedSorted(props.pages))
    const scheduled = createMemo(() => scheduledSorted(props.pages, now()))
    const resolved = createMemo(() => resolvedSorted(props.pages))
    const open = createMemo(() => [...due(), ...failed(), ...scheduled()])
    const [expanded, setExpanded] = createSignal(false)
    const [resolvedOpen, setResolvedOpen] = createSignal(false)
    const limited = createMemo(
        () => props.limit !== undefined && open().length > props.limit,
    )
    const shownOpen = createMemo(() =>
        props.limit === undefined || expanded()
            ? open()
            : open().slice(0, props.limit),
    )

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
            {rows(shownOpen())}
            <Show when={limited()}>
                <DaemonMoreLine
                    label={
                        expanded()
                            ? `all ${open().length}`
                            : `+${open().length - (props.limit as number)} more`
                    }
                    open={expanded()}
                    onToggle={() => setExpanded(v => !v)}
                />
            </Show>
            <Show when={resolved().length > 0}>
                <DaemonMoreLine
                    label={`${resolved().length} resolved`}
                    open={resolvedOpen()}
                    onToggle={() => setResolvedOpen(v => !v)}
                />
                <Show when={resolvedOpen()}>{rows(resolved())}</Show>
            </Show>
        </DaemonSection>
    )
}

export default DaemonInbox
