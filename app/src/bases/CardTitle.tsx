import type { Component, JSX } from 'solid-js'
import styles from './CardTitle.module.css'

export type CardTitleProps = {
    class?: string
    children?: JSX.Element
}

/**
 * A card's title line — shared by BodyCard and CardBody, both of which imported the same
 * unqualified `.cardTitle` rule out of the old bases/BaseView.module.css.
 */
const CardTitle: Component<CardTitleProps> = props => (
    <div class={`${styles.cardTitle} ${props.class ?? ''}`}>{props.children}</div>
)

export default CardTitle
