import { splitProps, type Component, type JSX } from 'solid-js'
import styles from './Band.module.css'

export type BandProps = {
    children?: JSX.Element
    class?: string
    /** Which edge carries the --rule-soft hairline, or `none` for no hairline. Default 'bottom'. */
    rule?: 'top' | 'bottom' | 'none'
    /** No inline padding — for a caller that owns its own. The hairline is unaffected. */
    flush?: boolean
    /** A NAMED extra start inset — never a px value, so the number exists once.
     *  `traffic-lights`: the macOS overlay-titlebar gap (TopStrip). `rail`: the mirrored tab rail's
     *  nudge. Combined with `flush` it is the ONLY padding the band has. */
    inset?: 'traffic-lights' | 'rail'
    /** Vertical padding, for a wrapping IconBar's stacked icons (the collapsed tab rail). */
    padBlock?: boolean
    /** One text row tall (--row-h) instead of --h-band: a band that is a status line, not a header
     *  (the status bar). Same side padding and hairline — only the height differs. */
    compact?: boolean
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'class'>

/**
 * The chrome band: --h-band tall, --sp-5 side padding, a --rule-soft bottom hairline. The one
 * definition of that shape — `ViewBar` and a `band` `IconBar` both render through it, so a toolbar
 * and a view header stacked in one column share their edges. It owns the box only; the composer
 * owns layout via `class`. A band never sets its own padding: `flush`, `inset` and `padBlock` exist
 * so a caller that needs a different one asks here instead of hand-writing it. Every other
 * attribute (role, aria-*, data-*, style) passes through.
 */
const Band: Component<BandProps> = props => {
    const [local, rest] = splitProps(props, [
        'children',
        'class',
        'rule',
        'flush',
        'inset',
        'padBlock',
        'compact',
    ])
    const classes = () =>
        [
            styles.band,
            local.rule === 'top' && styles['rule-top'],
            local.rule === 'none' && styles['rule-none'],
            local.flush && styles.flush,
            local.inset && styles[`inset-${local.inset}`],
            local.padBlock && styles['pad-block'],
            local.compact && styles.compact,
            local.class,
        ]
            .filter(Boolean)
            .join(' ')
    return (
        <div class={classes()} {...rest}>
            {local.children}
        </div>
    )
}

export default Band
