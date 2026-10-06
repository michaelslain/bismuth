// app/src/daemon/DaemonTakeover.tsx
// The opened-section frame: ONE quiet box filling the daemon page's stage. Heading (name + count)
// and `[x close]` stay put; only the body scrolls. Esc closes it unless something inside already
// handled that Esc (a context menu) — see takeoverDismiss.ts.
import { onCleanup, onMount, Show, type JSX } from 'solid-js'
import Card from '../ui/Card'
import Text from '../ui/Text'
import IconTextButton from '../ui/IconTextButton'
import { isDismissKey } from '../ui/widgetKeys'
import { shouldCloseOnKey } from './takeoverDismiss'
import styles from './DaemonTakeover.module.css'

export type DaemonTakeoverProps = {
    title: string
    count?: number
    onClose: () => void
    children: JSX.Element
    class?: string
}

function DaemonTakeover(props: DaemonTakeoverProps) {
    onMount(() => {
        const onKey = (e: KeyboardEvent) => {
            if (shouldCloseOnKey(e, isDismissKey(e))) {
                e.preventDefault()
                props.onClose()
            }
        }
        // window, not document: its bubble phase runs after every document listener, so a
        // context menu (registered later, on open) has already claimed its Esc.
        window.addEventListener('keydown', onKey)
        onCleanup(() => window.removeEventListener('keydown', onKey))
    })
    return (
        <Card
            variant="quiet"
            class={`${styles.takeover} ${props.class ?? ''}`}
            data-testid="daemon-takeover"
        >
            <div class={styles.heading}>
                <div class={styles.title}>
                    <Text size="ui" weight="bold">
                        {props.title}
                    </Text>
                    <Show when={props.count !== undefined}>
                        <Text size="ui" tone="faint">
                            {props.count}
                        </Text>
                    </Show>
                </div>
                <IconTextButton
                    icon="X"
                    data-testid="daemon-takeover-close"
                    onClick={() => props.onClose()}
                >
                    close
                </IconTextButton>
            </div>
            <div class={styles.body}>{props.children}</div>
        </Card>
    )
}

export default DaemonTakeover
