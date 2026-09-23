// app/src/daemon/MemoryRow.tsx
// One memory row, two lines: name + type + age (right-aligned), then a one-line excerpt. Click
// opens the note the memory is about; `[ forget ]` sits trailing and asks `[ forget ] [ cancel ]`
// inline on first press — the same two-press confirm shape as DaemonInbox's approve-all and
// DaemonServices' context-menu delete, just inline instead of a section head. DaemonMemory.tsx is
// the ONLY importer; it owns the `confirming` signal (only one row confirms at a time) and the
// actual `onForget(path)` call.
import { createEffect } from 'solid-js'
import { Show } from 'solid-js'
import { isDismissKey } from '../ui/widgetKeys'
import PlainButton from '../ui/PlainButton'
import { TextButton } from '../ui/TextButton'
import Text from '../ui/Text'
import { memoryAge } from './memoryListModel'
import type { MemoryListItem } from './DaemonMemory'
import styles from './MemoryRow.module.css'

export type MemoryRowProps = {
    item: MemoryListItem
    /** Confirm-to-forget is armed for this row. Only one row confirms at a time — the parent owns
     *  which. */
    confirming: boolean
    onOpen: () => void
    /** First press — the parent arms `confirming`; this row does not delete anything itself. */
    onForget: () => void
    /** Second press — the parent actually calls its `onForget(path)`. */
    onConfirm: () => void
    onCancel: () => void
    class?: string
}

function MemoryRow(props: MemoryRowProps) {
    let cancelRef: HTMLButtonElement | undefined

    // Focus lands on the safe choice the moment confirm arms, so a stray Enter backs out rather
    // than deleting — same defensive default as DaemonInbox's approve-all confirm.
    createEffect(() => {
        if (props.confirming) queueMicrotask(() => cancelRef?.focus())
    })

    return (
        <div class={`${styles['memory-row']} ${props.class ?? ''}`}>
            <PlainButton
                class={styles['memory-row-open']}
                aria-label={`${props.item.name}, ${props.item.type}`}
                onClick={props.onOpen}
            >
                <div class={styles['memory-row-head']}>
                    <Text
                        as="span"
                        size="inherit"
                        weight="bold"
                        class={styles['memory-row-name']}
                    >
                        {props.item.name}
                    </Text>
                    <Text
                        as="span"
                        size="inherit"
                        tone="faint"
                        class={styles['memory-row-type']}
                    >
                        {props.item.type}
                    </Text>
                    <Text
                        as="span"
                        size="inherit"
                        tone="faint"
                        class={styles['memory-row-age']}
                    >
                        {memoryAge(props.item.updated, Date.now())}
                    </Text>
                </div>
                <Text
                    as="div"
                    size="inherit"
                    tone="muted"
                    class={styles['memory-row-excerpt']}
                >
                    {props.item.excerpt}
                </Text>
            </PlainButton>
            <div
                class={styles['memory-row-actions']}
                onKeyDown={e => {
                    if (props.confirming && isDismissKey(e)) {
                        e.stopPropagation()
                        props.onCancel()
                    }
                }}
            >
                <Show
                    when={props.confirming}
                    fallback={
                        <TextButton
                            variant="unselected"
                            class={styles['memory-row-forget']}
                            onClick={props.onForget}
                        >
                            forget
                        </TextButton>
                    }
                >
                    <TextButton danger onClick={props.onConfirm}>
                        forget
                    </TextButton>
                    <TextButton ref={cancelRef} onClick={props.onCancel}>
                        cancel
                    </TextButton>
                </Show>
            </div>
        </div>
    )
}

export default MemoryRow
