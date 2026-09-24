// app/src/daemon/DaemonMoreLine.tsx
// The one trailing toggle line a daemon-page section uses to reveal rows it is holding back —
// `+7 more // show` under a row-limited list, `2 resolved // show` under the inbox. The label is
// the caller's (it changes with the state: `+7 more` collapsed, `all 12` open); this owns the
// `// show` / `// hide` half, the row inset and the button semantics.
import PlainButton from '../ui/PlainButton'
import Text from '../ui/Text'
import styles from './DaemonMoreLine.module.css'

export type DaemonMoreLineProps = {
    /** What is behind the toggle, e.g. `+7 more`, `all 12`, `2 resolved`. */
    label: string
    open: boolean
    onToggle: () => void
    class?: string
}

function DaemonMoreLine(props: DaemonMoreLineProps) {
    return (
        <PlainButton
            class={`${styles.line} ${props.class ?? ''}`}
            aria-expanded={props.open}
            onClick={() => props.onToggle()}
            data-testid="daemon-more-line"
        >
            <Text as="span" size="ui" tone="faint">
                {`${props.label} // `}
            </Text>
            <Text as="span" size="ui" tone="muted">
                {props.open ? 'hide' : 'show'}
            </Text>
        </PlainButton>
    )
}

export default DaemonMoreLine
