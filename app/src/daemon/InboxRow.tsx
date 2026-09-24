// app/src/daemon/InboxRow.tsx
// One inbox row, one line: status dot + title + time. Clicking the row opens the page; the
// only action is `[archive]`, overlaid over the age on hover/focus-within — every other action
// (submit/dismiss/approve/retry) now lives at the bottom of the opened page itself.
// Extracted from the deleted app/src/InboxView.tsx's PageRow — DaemonInbox.tsx is the ONLY
// importer.
import { createSignal, Show } from 'solid-js'
import type { DaemonPage } from '../../../core/src/daemonPages'
import { STATUS_COLOR, STATUS_WORD } from '../daemonInboxLogic'
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
    onChanged: () => void
    class?: string
}

function InboxRow(props: InboxRowProps) {
    const [archiving, setArchiving] = createSignal(false)
    const failed = () => props.page.status === 'failed'
    const time = () => relTimeISO(props.page.createdAt)

    // The dot is colour only, so the button carries the words a screen reader needs, in the
    // order a sighted reader scans them — instead of one run-on string of every span inside.
    const label = () =>
        [
            props.page.title,
            STATUS_WORD[props.page.status],
            props.page.source && `from ${props.page.source}`,
            time(),
            failed() && (props.page.daemonNote || 'The daemon could not finish.'),
        ]
            .filter(Boolean)
            .join(', ')

    async function archive(e: MouseEvent): Promise<void> {
        e.stopPropagation()
        if (archiving()) return
        setArchiving(true)
        try {
            await api.archiveDaemonPage(props.page.path)
            props.onChanged()
        } catch (e) {
            pushToast(`Couldn't archive: ${(e as Error).message}`)
        } finally {
            setArchiving(false)
        }
    }

    return (
        <div class={`${styles['inbox-row']} ${props.class ?? ''}`}>
            {/* A real button element around only the non-interactive part. ARIA's button role is
                Children Presentational — wrapping archive too would hide it from assistive tech,
                so it stays a sibling instead. */}
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
            </PlainButton>
            <Show when={props.page.status !== 'working'}>
                <div class={styles['inbox-row-actions']}>
                    <TextButton
                        danger
                        aria-busy={archiving()}
                        onClick={archive}
                        onPointerDown={e => e.stopPropagation()}
                    >
                        {archiving() ? '…' : 'archive'}
                    </TextButton>
                </div>
            </Show>
        </div>
    )
}

export default InboxRow
