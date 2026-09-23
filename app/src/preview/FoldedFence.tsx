// app/src/preview/FoldedFence.tsx
// The one-row `--- … ---` shown in place of CompanionFrontmatter's full block when folded — the
// same fence chrome as the note editor's own frontmatter fences, collapsed to a single row (see
// FoldedFence.module.css for exactly which note-editor rules each value mirrors).
import type { JSX } from 'solid-js'
import Text from '../ui/Text'
import styles from './FoldedFence.module.css'

export type FoldedFenceProps = {
    class?: string
}

function FoldedFence(props: FoldedFenceProps): JSX.Element {
    return (
        <div class={[styles['folded-fence'], props.class].filter(Boolean).join(' ')}>
            <Text as="span" size="inherit" tone="inherit" weight="inherit">
                --- … ---
            </Text>
        </div>
    )
}

export default FoldedFence
