// app/src/ui/Card.tsx
// The flat bordered surface primitive — formerly the bare `.asc-card`/`.asc-card--proposal`
// classes in ui/ui.css that a call site had to remember by hand. Real component, colocated
// module + story, per the 2026-08-27 visual-unification audit's §9.8 ("a shared stylesheet is
// evidence of a missing component").
import type { JSX } from 'solid-js'
import styles from './Card.module.css'

export type CardVariant = 'default' | 'proposal'

export type CardProps = {
    /** 'default' (flat --surface-1 fill, hairline border) | 'proposal' — adds the shared 2px
     *  accent LEFT edge (--accent-edge, same treatment as Callout/Frontmatter) for a suggested
     *  item inside a list, e.g. VaultIntro's power-up rows. */
    variant?: CardVariant
    class?: string
    children?: JSX.Element
}

function cardClass(props: CardProps): string {
    return [
        styles.card,
        props.variant === 'proposal' ? styles['card--proposal'] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

function Card(props: CardProps) {
    return <div class={cardClass(props)}>{props.children}</div>
}

export default Card
export { Card }
