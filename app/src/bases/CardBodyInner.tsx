import type { Component, JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import styles from './CardBodyInner.module.css'

export type CardBodyInnerProps = {
    class?: string
    children?: JSX.Element
} & JSX.HTMLAttributes<HTMLDivElement>

/**
 * The padded body wrapper under a CardsView card's cover (around `<CardBody>`).
 */
const CardBodyInner: Component<CardBodyInnerProps> = props => {
    const [local, rest] = splitProps(props, ['class', 'children'])
    return (
        <div class={`${styles.cardBodyInner} ${local.class ?? ''}`} {...rest}>
            {local.children}
        </div>
    )
}

export default CardBodyInner
