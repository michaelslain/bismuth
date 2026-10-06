// app/src/daemon/DaemonInbox.tsx
// The content of the deleted app/src/InboxView.tsx (the former `::inbox` tab), now a flat list
// over the pages the daemon has written (core/src/daemonPages.ts): due, failed, then scheduled —
// each group's existing sort, concatenated with no group headings (the daemon page's own
// `DaemonSection` heading is the only heading now). Recently resolved (done/dismissed) stays
// summarised by a trailing `N resolved` line that opens the section. `pages` is a prop — the daemon page
// owns the poll and passes the result down, the same way it feeds DaemonProcesses/DaemonLog.
// `limit` row-caps the OPEN rows only (due/failed/scheduled are already attention-first, so a
// limit never hides a problem) behind a `+N more` line; both lines open the full section
// (`variant="full"`: every open row, then every resolved row).
import { createMemo, For, Show } from 'solid-js'
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
import Text from '../ui/Text'
import type { RowLimit } from './daemonRowBudget'
import styles from './DaemonInbox.module.css'

export type DaemonInboxProps = {
    /** 'box' (default): the capped list inside its DaemonSection box. 'full': every row, no box
     *  of its own — the opened section's DaemonTakeover supplies the heading. */
    variant?: 'box' | 'full'
    /** Opens this section full screen — the box heading, its open button and its more-line call it. */
    onOpenSection?: () => void
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
    const shownOpen = createMemo(() =>
        props.limit === undefined ? open() : open().slice(0, props.limit),
    )
    const limited = createMemo(
        () => props.limit !== undefined && open().length > props.limit,
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
        <Show
            when={props.variant === 'full'}
            fallback={
                <DaemonSection
                    title="inbox"
                    count={open().length}
                    countLabel={
                        open().length > 0
                            ? `${open().length} need you`
                            : undefined
                    }
                    attention={open().length > 0}
                    onOpen={props.onOpenSection}
                    empty="nothing needs you"
                    isEmpty={open().length === 0}
                    class={props.class}
                >
                    {rows(shownOpen())}
                    <Show when={limited()}>
                        <DaemonMoreLine
                            label={`+${open().length - (props.limit as number)} more`}
                            onOpen={() => props.onOpenSection?.()}
                        />
                    </Show>
                    <Show when={resolved().length > 0}>
                        <DaemonMoreLine
                            label={`${resolved().length} resolved`}
                            onOpen={() => props.onOpenSection?.()}
                        />
                    </Show>
                </DaemonSection>
            }
        >
            <div
                data-testid="daemon-inbox-full"
                class={`${styles['inbox-full']} ${props.class ?? ''}`}
            >
                <Show
                    when={open().length > 0}
                    fallback={<Text tone="faint">nothing needs you</Text>}
                >
                    {rows(open())}
                </Show>
                <Show when={resolved().length > 0}>
                    <Text
                        size="ui"
                        tone="faint"
                        class={styles['resolved-label']}
                    >
                        resolved
                    </Text>
                    {rows(resolved())}
                </Show>
            </div>
        </Show>
    )
}

export default DaemonInbox
