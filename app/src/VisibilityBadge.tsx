// Small glyph beside a file-tree row's icon, driven by the RESOLVED visibility (TreeEntry/TreeNode
// `visibility`, omitted for "all") — so a plain file deep inside a hidden folder still shows the
// badge without carrying its own frontmatter. Distinct glyph per tier; the tooltip names who the
// note is hidden FROM, which is the part users actually need. Restricts the daemon and the in-app
// chat only — see docs/vault/visibility.md.
//
// Extracted from FileTree.tsx (visual-unification audit §6/§9.8), where it was one of five
// components in one file and therefore had no story of its own.
import { Show, type Component } from 'solid-js'
import Badge from './ui/Badge'
import { Icon } from './icons/Icon'
import styles from './VisibilityBadge.module.css'

export type VisibilityBadgeProps = {
    /** Resolved visibility. `undefined` means "all" — the badge renders nothing. */
    visibility?: 'chat-only' | 'hidden'
    class?: string
}

const VisibilityBadge: Component<VisibilityBadgeProps> = props => (
    <Show when={props.visibility}>
        {v => (
            <Badge
                tone={v() === 'hidden' ? 'danger' : 'faint'}
                class={`${styles['ft-visibility-badge']} ${
                    v() === 'hidden' ? styles['hidden'] : ''
                } ${props.class ?? ''}`}
                title={
                    v() === 'hidden'
                        ? 'Hidden from the daemon and in-app chat'
                        : 'Chat only — hidden from the daemon'
                }
            >
                <Icon value={v() === 'hidden' ? 'EyeOff' : 'MessageSquareOff'} />
            </Badge>
        )}
    </Show>
)

export default VisibilityBadge
export { VisibilityBadge }
