// app/src/ui/FoldButton.tsx — FoldButton.module.css is the ONLY importer.
// A fold control outside a note: the app's fold triangle (ui/FoldArrow) in a button that hangs in
// the LEFT GUTTER of the line it folds, the same hit-box, tint and reveal as a note's heading fold
// (editor/foldBlocks.ts) — faint, shown while the pointer is over that line, kept shown while
// folded. Its host line marks itself with `data-fold-anchor` and is the positioned box it hangs off.
import type { Component } from 'solid-js'
import PlainButton from './PlainButton'
import FoldArrow from './FoldArrow'
import styles from './FoldButton.module.css'

export type FoldButtonProps = {
    open: boolean
    onToggle: () => void
    /** What it folds, for the accessible name: "message" → "Collapse message" / "Expand message". */
    what: string
    /** Merged onto the root, so a caller can adjust one instance without forking the component. */
    class?: string
}

const FoldButton: Component<FoldButtonProps> = props => (
    <PlainButton
        class={`${styles.fold} ${props.open ? '' : styles.shut} ${props.class ?? ''}`}
        aria-expanded={props.open}
        aria-label={`${props.open ? 'Collapse' : 'Expand'} ${props.what}`}
        title={`${props.open ? 'Collapse' : 'Expand'} ${props.what}`}
        onClick={() => props.onToggle()}
    >
        <FoldArrow collapsed={!props.open} />
    </PlainButton>
)

export default FoldButton
