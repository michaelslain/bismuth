// app/src/daemon/InboxRow.tsx
// One inbox row: status dot, title/source/time, a one-line snippet, and (when due) inline
// actions. Extracted from the deleted app/src/InboxView.tsx's PageRow — DaemonInbox.tsx is the
// ONLY importer.
import { createSignal, For, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import { STATUS_COLOR } from '../daemonInboxLogic'
import { api } from '../api'
import { pushToast } from '../Toast'
import { relTimeISO } from '../relTime'
import { TextButton } from '../ui/TextButton'
import PlainButton from '../ui/PlainButton'
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
            {/* A real button element around only the non-interactive part (dot + main text).
                ARIA's button role is Children Presentational — wrapping the actions below too
                would hide approve/dismiss from assistive tech, so those stay a sibling instead. */}
            <PlainButton
                class={styles['inbox-row-open']}
                onClick={() => props.onOpen(props.page.path)}
            >
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={styles['inbox-row-dot']}
                    style={{ color: STATUS_COLOR[props.page.status] }}
                />
                <div class={styles['inbox-row-main']}>
                    <div class={styles['inbox-row-head']}>
                        <Text
                            as="span"
                            size="inherit"
                            tone="inherit"
                            weight="inherit"
                            class={styles['inbox-row-title']}
                        >
                            {props.page.title}
                        </Text>
                        <Show when={props.page.source}>
                            <Text
                                as="span"
                                size="inherit"
                                tone="inherit"
                                weight="inherit"
                                class={styles['inbox-row-source']}
                            >
                                {props.page.source}
                            </Text>
                        </Show>
                        <Text
                            as="span"
                            size="inherit"
                            tone="inherit"
                            weight="inherit"
                            class={styles['inbox-row-time']}
                        >
                            {relTimeISO(props.page.createdAt)}
                        </Text>
                    </div>
                    <div class={styles['inbox-row-snippet']}>
                        {snippet(props.page.body)}
                    </div>
                </div>
            </PlainButton>
            <Show when={props.showActions}>
                <div class={styles['inbox-row-actions']}>
                    <For each={props.page.actions}>
                        {a => (
                            <TextButton
                                size="sm"
                                variant={
                                    a.kind === 'primary' ? 'selected' : 'normal'
                                }
                                danger={a.kind === 'danger'}
                                disabled={props.page.status === 'working'}
                                onClick={() => press(a.id)}
                            >
                                {props.page.status === 'working' &&
                                pressingId() === a.id
                                    ? '…'
                                    : a.label.toUpperCase()}
                            </TextButton>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    )
}

export default InboxRow
