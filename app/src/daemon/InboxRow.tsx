// app/src/daemon/InboxRow.tsx
// One inbox row, two lines: status dot + title + time, then source // snippet (or the failure
// note). Due and failed rows add their actions on a third line, aligned to the text column.
// Extracted from the deleted app/src/InboxView.tsx's PageRow — DaemonInbox.tsx is the ONLY
// importer.
import { createSignal, For, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import { STATUS_COLOR, STATUS_WORD, actionLabel } from '../daemonInboxLogic'
import { api } from '../api'
import { pushToast } from '../Toast'
import { relTimeISO } from '../relTime'
import { TextButton } from '../ui/TextButton'
import PlainButton from '../ui/PlainButton'
import StatusDot from '../ui/StatusDot'
import Text from '../ui/Text'
import styles from './InboxRow.module.css'

export type InboxRowProps = {
    page: DaemonPage
    onOpen: (path: string) => void
    showActions: boolean
    onChanged: () => void
    class?: string
}

/** ~120-char single-line preview of a page's body — collapse whitespace/markdown noise so the
 *  row reads as a snippet, not a wrapped paragraph. */
function snippet(body: string): string {
    const flat = body
        .replace(/[#*_`>[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    return flat.length > 120 ? flat.slice(0, 120) + '…' : flat
}

function InboxRow(props: InboxRowProps) {
    const [pressingId, setPressingId] = createSignal<string | null>(null)
    const failed = () => props.page.status === 'failed'
    // The section head, the dot and the danger tone already say "failed" — the line carries why.
    const failure = () =>
        props.page.daemonNote || 'The daemon could not finish.'
    const time = () => relTimeISO(props.page.createdAt)

    // The dot is colour only, so the button carries the words a screen reader needs, in the
    // order a sighted reader scans them — instead of one run-on string of every span inside.
    const label = () =>
        [
            props.page.title,
            STATUS_WORD[props.page.status],
            props.page.source && `from ${props.page.source}`,
            time(),
            failed() && failure(),
        ]
            .filter(Boolean)
            .join(', ')

    async function press(actionId: string): Promise<void> {
        setPressingId(actionId)
        try {
            const res = await api.resolveDaemonPage(props.page.path, actionId)
            if (res.alreadyResolved) pushToast('Already resolved')
            props.onChanged()
        } catch (e) {
            pushToast(`Couldn't resolve: ${(e as Error).message}`)
        } finally {
            setPressingId(null)
        }
    }

    return (
        <div class={`${styles['inbox-row']} ${props.class ?? ''}`}>
            {/* A real button element around only the non-interactive part. ARIA's button role is
                Children Presentational — wrapping the actions too would hide approve/dismiss
                from assistive tech, so those stay a sibling instead. */}
            <PlainButton
                class={styles['inbox-row-open']}
                aria-label={label()}
                onClick={() => props.onOpen(props.page.path)}
            >
                <StatusDot color={STATUS_COLOR[props.page.status]} />
                <Text
                    as="span"
                    size="inherit"
                    weight="bold"
                    class={styles['inbox-row-title']}
                >
                    {props.page.title}
                </Text>
                <Text
                    as="span"
                    size="inherit"
                    tone="faint"
                    class={styles['inbox-row-time']}
                >
                    {time()}
                </Text>
                <Text
                    as="span"
                    size="inherit"
                    tone="muted"
                    class={styles['inbox-row-meta']}
                >
                    <Show when={props.page.source}>
                        <Text
                            as="span"
                            size="inherit"
                            tone="faint"
                            weight="inherit"
                        >
                            {props.page.source} //{' '}
                        </Text>
                    </Show>
                    <Show when={failed()} fallback={snippet(props.page.body)}>
                        <Text
                            as="span"
                            size="inherit"
                            tone="inherit"
                            weight="inherit"
                            class={styles['inbox-row-failure']}
                        >
                            {failure()}
                        </Text>
                    </Show>
                </Text>
            </PlainButton>
            <Show when={props.showActions}>
                <div class={styles['inbox-row-actions']}>
                    <For each={props.page.actions}>
                        {a => (
                            <TextButton
                                variant={
                                    a.kind === 'primary' ? 'selected' : 'normal'
                                }
                                danger={a.kind === 'danger'}
                                disabled={props.page.status === 'working'}
                                aria-busy={pressingId() === a.id}
                                onClick={() => press(a.id)}
                            >
                                {props.page.status === 'working' &&
                                pressingId() === a.id
                                    ? '…'
                                    : actionLabel(props.page, a.id)}
                            </TextButton>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    )
}

export default InboxRow
