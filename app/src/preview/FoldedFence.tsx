// app/src/preview/FoldedFence.tsx
// The one row shown in place of CompanionFrontmatter's full block when folded — the same fence
// chrome as the note editor's own frontmatter fences, collapsed to a single row (see
// FoldedFence.module.css for exactly which note-editor rules each value mirrors). Between the
// fences sits a one-line preview of the properties (frontmatterSummary.ts), cut with an ellipsis
// when it outgrows the row; with nothing to preview it reads `--- … ---`.
import type { JSX } from 'solid-js'
import Text from '../ui/Text'
import styles from './FoldedFence.module.css'

export type FoldedFenceProps = {
    /** One-line property preview (summarizeFrontmatter's output); empty or absent shows `…`. */
    summary?: string
    class?: string
}

function FoldedFence(props: FoldedFenceProps): JSX.Element {
    return (
        <div
            class={[styles['folded-fence'], props.class].filter(Boolean).join(' ')}
            title={props.summary || undefined}
        >
            <Text as="span" inherit class={styles.fence}>
                ---
            </Text>
            <Text as="span" inherit class={styles.summary} data-testid="folded-summary">
                {props.summary || '…'}
            </Text>
            <Text as="span" inherit class={styles.fence}>
                ---
            </Text>
        </div>
    )
}

export default FoldedFence
