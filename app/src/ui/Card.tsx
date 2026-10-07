// app/src/ui/Card.tsx
// The flat bordered surface primitive — formerly the bare `.asc-card`/`.asc-card--proposal`
// classes in ui/ui.css that a call site had to remember by hand. Real component, colocated
// module + story, per the 2026-08-27 visual-unification audit's §9.8 ("a shared stylesheet is
// evidence of a missing component").
import { splitProps, type JSX } from 'solid-js'
import styles from './Card.module.css'

// Two seams for a host that tints a surface without a third card recipe, both custom properties
// set on the card or an ancestor (they INHERIT, so a Card nested under a tinted one takes the tint
// too): `--card-bg` is the fill (default/proposal fall back to --surface-1, quiet to --editor) and
// `--card-border` is the whole hairline shorthand (default `--rule`; `quiet` keeps its --rule-soft).
export type CardVariant = 'default' | 'proposal' | 'quiet'

export type CardProps = {
    /** 'quiet' — `--editor` fill, `--rule-soft` border, for side-by-side panels. 'default' (flat --surface-1 fill, hairline border) | 'proposal' — adds the shared 2px
     *  accent LEFT edge (--accent-edge, same treatment as Callout/Frontmatter) for a suggested
     *  item inside a list, e.g. VaultIntro's power-up rows. */
    variant?: CardVariant
    /** The surface is waiting on the user — orthogonal to `variant` (`--warning-edge` border + a `--warning-soft` tint layered over the fill). */
    attention?: boolean
    class?: string
    children?: JSX.Element
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'children'>

function cardClass(props: CardProps): string {
    return [
        styles.card,
        props.variant === 'proposal' ? styles['card--proposal'] : '',
        props.variant === 'quiet' ? styles['card--quiet'] : '',
        props.attention ? styles['card--attention'] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

function Card(props: CardProps) {
    const [local, rest] = splitProps(props, ['variant', 'attention', 'class', 'children'])
    return (
        <div {...rest} class={cardClass(local)}>
            {local.children}
        </div>
    )
}

export default Card
export { Card }
