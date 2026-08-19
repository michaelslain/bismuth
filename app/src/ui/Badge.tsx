import type { Component, JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import styles from './Badge.module.css'
import './ui.css'

export type BadgeTag = 'span' | 'div'
export type BadgeVariant = 'inline' | 'solid'
export type BadgeTone = 'muted' | 'faint' | 'danger'

export type BadgeProps = {
    /** Tag to render. 'span' (default). */
    as?: BadgeTag
    /** 'inline' (default): a plain de-emphasized run with no chrome of its own — a count or
     *  status glyph sitting inside surrounding text or a flex row (daemon-section-count,
     *  inbox-section-count, sresult-count, cards-count, ft-visibility-badge). 'solid': a filled
     *  pill chip (the toolbar's live-count badge) — background, rounded corners, inverse text.
     *  Positioning it against its anchor (CommandButton.module.css's `.toolbar-badge`'s
     *  `position: absolute; top/right`) is the CALLER's layout, not this component's — that stays
     *  in the caller's module. */
    variant?: BadgeVariant
    /** Text color for the 'inline' variant: 'muted' (--text-muted), 'faint' (--faint), 'danger'
     *  (--danger, ft-visibility-badge's hidden state). Omit to inherit the ambient color instead
     *  — some counts (daemon/inbox section heads) sit inside an already-colored eyebrow and only
     *  need the caller's own opacity dimming, not a color of their own. Ignored by 'solid', which
     *  is always --bg on --accent. */
    tone?: BadgeTone
    /** Native tooltip — the visibility badge names who a file is hidden from. */
    title?: string
    class?: string
    children?: JSX.Element
}

function badgeClass(props: BadgeProps): string {
    const variant = props.variant ?? 'inline'
    return [
        styles.badge,
        variant === 'solid' ? styles['badge--solid'] : '',
        props.tone ? styles[`badge--${props.tone}`] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

/**
 * The small count/indicator primitive: a de-emphasized number or status glyph riding alongside
 * a label — a section head's row count, a search result's match count, a file tree's visibility
 * glyph, a toolbar button's live-count pill. Variants are props (variant/tone), not separate
 * components; see Badge.module.css for where each token comes from.
 */
const Badge: Component<BadgeProps> = props => {
    return (
        <Dynamic
            component={props.as ?? 'span'}
            class={badgeClass(props)}
            title={props.title}
        >
            {props.children}
        </Dynamic>
    )
}

export default Badge
