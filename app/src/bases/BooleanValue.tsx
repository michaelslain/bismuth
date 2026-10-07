// app/src/bases/BooleanValue.tsx
// A boolean, read-only: the `[ ]` / `[x]` bracket glyph (ui/BracketToggle). One spelling for every
// place a Bases view shows a boolean — it was `x`, `Yes`/`No`, a `[Yes]`/`[No]` chip, `[x]` and
// blank-for-false in five files. PropertyControl's toggle wraps THIS in a button, so the edit
// control has the same shape as the value it replaces.
import type { Component } from 'solid-js'
import BracketToggle from '../ui/BracketToggle'
import Text from '../ui/Text'
import styles from './BooleanValue.module.css'

export type BooleanValueProps = {
    value: boolean
    /** Merged onto the root so a caller can adjust one instance without forking this. */
    class?: string
}

const BooleanValue: Component<BooleanValueProps> = props => (
    <Text
        as="span"
        inherit
        class={`${styles.bool} ${props.class ?? ''}`.trim()}
        role="img"
        aria-label={props.value ? 'yes' : 'no'}
        data-checked={props.value ? '' : undefined}
    >
        <BracketToggle checked={props.value} />
    </Text>
)

export default BooleanValue
