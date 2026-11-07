// app/src/ui/FoldArrow.tsx — FoldArrow.module.css is the ONLY importer.
// The fold triangle: a small filled triangle that points down while its block is open and right
// while it is folded. It is the one glyph every fold in the app draws — a note's heading and list
// folds (editor/foldBlocks.ts mounts it into its CodeMirror widget), the same folds inside a chat
// message (which renders through that note view), and a chat message's own fold (FoldButton). It
// takes its colour from the host (`currentColor`), so the host owns faint / hover / locked tints.
import type { Component } from 'solid-js'
import styles from './FoldArrow.module.css'

export type FoldArrowProps = {
    collapsed: boolean
    class?: string
}

const FoldArrow: Component<FoldArrowProps> = props => (
    <span
        class={`${styles.arrow} ${props.class ?? ''}`}
        data-fold-glyph
        data-collapsed={props.collapsed ? '' : undefined}
        aria-hidden="true"
    />
)

export default FoldArrow
