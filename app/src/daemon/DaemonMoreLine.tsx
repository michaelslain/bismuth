// app/src/daemon/DaemonMoreLine.tsx
// The one trailing line a daemon-page box ends with when it holds rows back — `+7 more` under a
// row-limited list, `2 resolved` under the inbox. Clicking it opens the section full screen; the
// label is the caller's, this owns the row inset and the button semantics.
import PlainButton from '../ui/PlainButton'
import Text from '../ui/Text'
import styles from './DaemonMoreLine.module.css'

export type DaemonMoreLineProps = {
    /** What is behind the line, e.g. `+7 more`, `2 resolved`. */
    label: string
    /** Opens the section this line belongs to. */
    onOpen?: () => void
    class?: string
}

function DaemonMoreLine(props: DaemonMoreLineProps) {
    return (
        <PlainButton
            class={`${styles.line} ${props.class ?? ''}`}
            onClick={() => props.onOpen?.()}
            data-testid="daemon-more-line"
        >
            <Text as="span" size="ui" tone="muted">
                {props.label}
            </Text>
        </PlainButton>
    )
}

export default DaemonMoreLine
