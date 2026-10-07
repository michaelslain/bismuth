import { splitProps, type Component, type JSX } from 'solid-js'
import Text from './Text'
import styles from './Badge.module.css'

export type BadgeTag = 'span' | 'div'
export type BadgeVariant = 'inline' | 'solid'
export type BadgeTone = 'muted' | 'faint' | 'danger'
/** 'sm' = --fs-micro, 'md' = --fs-ui. Omit on an 'inline' badge to inherit the ambient size. */
export type BadgeSize = 'sm' | 'md'
export type BadgeHue = 'teal' | 'blue' | 'violet' | 'green' | 'gold' | 'rose'

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
    /** Solid variant only: the category colour replaces --accent; --bg text stays. */
    hue?: BadgeHue
    /** Type size: 'sm' (--fs-micro) or 'md' (--fs-ui). Omit to inherit the ambient size, which is
     *  right for a count riding inside a label that already sets its own; a 'solid' chip
     *  defaults to 'sm', the size it has always been. */
    size?: BadgeSize
    /** Keeps the badge in one piece: `display: inline-block; white-space: nowrap`, so a count
     *  never splits across two lines ("12" / "hits"). For the surfaces that
     *  restyle a Badge into an inline count beside a heading or row label. */
    inline?: boolean
    class?: string
    children?: JSX.Element
} & Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'class' | 'children'>

function badgeClass(props: BadgeProps): string {
    const variant = props.variant ?? 'inline'
    return [
        variant === 'solid' ? styles['badge--solid'] : '',
        props.inline ? styles['badge--inline'] : '',
        props.hue ? styles[`badge--hue-${props.hue}`] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

/**
 * The small count/indicator primitive: a de-emphasized number or status glyph riding alongside
 * a label — a section head's row count, a search result's match count, a file tree's visibility
 * glyph, a toolbar button's live-count pill. It composes `Text` for the type (tone, size,
 * weight), so the ink tones live in one place; Badge adds only the chip chrome. Variants are
 * props (variant/tone/size/hue/inline), not separate components; see Badge.module.css. Every
 * other HTML attribute (title, style, classList, onClick, aria-*, data-*, id, role) and `ref`
 * pass through untouched onto the rendered element.
 */
const Badge: Component<BadgeProps> = props => {
    const [local, rest] = splitProps(props, [
        'as',
        'variant',
        'tone',
        'hue',
        'size',
        'inline',
        'class',
        'children',
    ])
    const solid = () => local.variant === 'solid'
    // 'solid' is always on-accent ink (Badge.module.css), so it never takes a tone; its size
    // defaults to micro, the size the toolbar chip has always been.
    const size = () =>
        local.size === 'md'
            ? 'ui'
            : local.size === 'sm' || solid()
              ? 'micro'
              : undefined
    return (
        <Text
            {...rest}
            inherit
            as={local.as ?? 'span'}
            tone={solid() ? undefined : local.tone}
            size={size()}
            weight={solid() ? 'bold' : undefined}
            class={badgeClass(props)}
        >
            {local.children}
        </Text>
    )
}

export default Badge
