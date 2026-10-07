import type { Component, JSX } from 'solid-js'
import Text from '../ui/Text'
import styles from './CardTitle.module.css'

export type CardTitleProps = {
    /** 2 clamps the title to two lines with an ellipsis (a cover's title band); omit to let it
     *  wrap freely (a body card's title). */
    lines?: 2
    class?: string
    children?: JSX.Element
}

/**
 * THE card title — one look for BodyCard, CardBody and the generated cover. A card title is
 * what a person WROTE, so it is prose (the serif, at the prose size, medium weight) per DESIGN's
 * register rule; it used to be mono bold at two different sizes within one Cards view.
 */
const CardTitle: Component<CardTitleProps> = props => (
    <Text
        as="div"
        size="inherit"
        weight="medium"
        register="prose"
        class={[
            styles.cardTitle,
            props.lines === 2 ? styles.clamp : '',
            props.class,
        ]
            .filter(Boolean)
            .join(' ')}
    >
        {props.children}
    </Text>
)

export default CardTitle
