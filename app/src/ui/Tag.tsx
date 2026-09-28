import { splitProps, type Component, type JSX } from 'solid-js'
import styles from './Tag.module.css'

export type TagProps = {
    /** The tag name, with or without its leading `#` — it is always shown with exactly one. */
    name: string
    class?: string
} & Omit<JSX.HTMLAttributes<HTMLSpanElement>, 'class' | 'children'>

/** One `#tag`, drawn the way a tag reads everywhere a value is shown (a table cell, a card's
 *  meta row): teal, in the UI face, never wrapping mid-tag. Plain text — no chip, no box. */
const Tag: Component<TagProps> = props => {
    const [local, rest] = splitProps(props, ['name', 'class'])
    return (
        <span class={`${styles.tag} ${local.class ?? ''}`.trim()} {...rest}>
            #{local.name.replace(/^#+/, '')}
        </span>
    )
}

export default Tag
