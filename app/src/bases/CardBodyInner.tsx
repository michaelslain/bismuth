import type { Component, JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import styles from './CardBodyInner.module.css'

export type CardBodyInnerProps = {
    /** KanbanView's slightly looser vertical rhythm (--sp-4 vs. CardsView's --sp-3). */
    looseGap?: boolean
    class?: string
    children?: JSX.Element
} & JSX.HTMLAttributes<HTMLDivElement>

/**
 * The padded body wrapper under a card's cover/face — shared by CardsView (around
 * <CardBody>) and KanbanView (around <KanbanCard>). Extracted because both views imported
 * the same unqualified `.cardBodyInner` rule out of the old bases/BaseView.module.css.
 */
const CardBodyInner: Component<CardBodyInnerProps> = props => {
    const [local, rest] = splitProps(props, ['looseGap', 'class', 'children'])
    return (
        <div
            class={`${styles.cardBodyInner} ${local.looseGap ? styles.looseGap : ''} ${local.class ?? ''}`}
            {...rest}
        >
            {local.children}
        </div>
    )
}

export default CardBodyInner
