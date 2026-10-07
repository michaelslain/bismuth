// app/src/ui/Readout.tsx
// THE `a // b // c` line: a handful of facts joined by the house separator, one line, ellipsis on
// overflow. Reach for it instead of hand-writing `parts.join(' // ')` in a row of your own — seven
// surfaces did, and each drifted (size, tone, truncation). Parts can be elements as well as strings
// (a NoteLink inside a readout), which is why this joins in JSX rather than with `join`.
//
// Muted at rest; `tone="default"` lifts it to `--fg` for the live state (hovering a chart bucket).
import type { Component, JSX } from 'solid-js'
import Text from './Text'
import styles from './Readout.module.css'

export type ReadoutProps = {
    /** Joined with ` // `. Strings or elements. */
    parts: (string | JSX.Element)[]
    /** `muted` (default) at rest; `default` is `--fg`, for the active/hovered state. */
    tone?: 'muted' | 'default'
    class?: string
}

const Readout: Component<ReadoutProps> = props => {
    return (
        <Text
            as="div"
            inherit
            size="ui"
            class={`${styles.readout} ${props.tone === 'default' ? styles.active : ''} ${props.class ?? ''}`}
        >
            {props.parts.map((part, i) => (
                <>
                    {i > 0 ? ' // ' : ''}
                    {part}
                </>
            ))}
        </Text>
    )
}

export default Readout
