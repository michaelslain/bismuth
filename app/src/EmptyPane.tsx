// app/src/EmptyPane.tsx
// Shown when a pane has no content yet: one row of icon buttons that fill THIS pane (open a
// file, a new chat, a new terminal), plus a faint hint that a note can be dragged in. The pane's
// header title is left blank (see tabIds.contentLabel) so an empty pane reads as truly empty.
import IconButton from './ui/IconButton'
import Text from './ui/Text'
import { emptyPaneActions, type EmptyPaneAction } from './emptyPaneActions'
import styles from './EmptyPane.module.css'

export type { EmptyPaneAction }

export type EmptyPaneProps = {
    /** A row was picked; the pane fills with what it names (App routes it to this leaf). */
    onPick: (action: EmptyPaneAction) => void
    class?: string
}

export function EmptyPane(props: EmptyPaneProps) {
    // `empty-pane`, not `empty`: a bare global `.empty` (display:flex, height:100%)
    // silently captured any other component's `empty` span — it was what broke the
    // flashcards progress meter onto three lines. See EmptyPane.module.css's header.
    return (
        <div class={`${styles['empty-pane']} ${props.class ?? ''}`}>
            <div class={styles['empty-actions']}>
                {emptyPaneActions.map(a => (
                    <IconButton
                        icon={a.icon}
                        label={a.label}
                        quiet
                        /* icon-size-exempt: the empty pane's centred illustration marks, not chrome */
                        iconSize={18}
                        size="sm"
                        data-empty-pane-action={a.id}
                        onClick={() => props.onPick(a.id)}
                        // The pane focuses on mousedown; the pick decides what lands in it, so the
                        // press must not first refocus another pane's leaf (PaneLeaf onMouseDown).
                        onMouseDown={e => e.stopPropagation()}
                    />
                ))}
            </div>
            <Text as="div" size="body" tone="muted" italic class={styles['empty-hint']}>
                or drag a note here
            </Text>
        </div>
    )
}

export default EmptyPane
