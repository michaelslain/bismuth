import { Show, type Component, type JSX } from 'solid-js'
import Text from './Text'
import styles from './IconBrackets.module.css'

export type IconBracketsState =
    /** Painted `[` `]` in the surrounding ink: the member is ON. */
    | 'on'
    /** Laid out, not painted: an off member of a toggle keeps its width. */
    | 'reserved'
    /** No brackets and no space. */
    | 'off'

export type IconBracketsProps = {
    state: IconBracketsState
    /** Hang the brackets outside the icon's box (absolutely positioned) instead of laying them out
     *  as flex siblings of it. The tab rail's active row uses this so the icon never moves. */
    anchored?: boolean
    /** Merged onto the group: set the ink the brackets inherit. */
    class?: string
    children: JSX.Element
}

/**
 * The single owner of the `[▣]` icon-bracket recipe (see IconBrackets.module.css). Wraps the icon:
 * inline (default) the group generates no box, so the brackets are flex siblings of the icon in the
 * enclosing button; `anchored` makes the group the brackets' containing block. The glyphs are
 * aria-hidden, so the accessible name stays the control's own label.
 */
const IconBrackets: Component<IconBracketsProps> = props => {
    const bracket = (side: 'start' | 'end') => (
        <Text
            as="span"
            inherit
            aria-hidden="true"
            class={`${styles.bracket} ${styles[side]} ${props.state === 'reserved' ? styles.reserved : ''}`}
        >
            {side === 'start' ? '[' : ']'}
        </Text>
    )
    return (
        <Text
            as="span"
            inherit
            class={`${styles.group} ${props.anchored ? styles.anchored : ''} ${props.class ?? ''}`}
        >
            <Show when={props.state !== 'off'}>{bracket('start')}</Show>
            {props.children}
            <Show when={props.state !== 'off'}>{bracket('end')}</Show>
        </Text>
    )
}

export default IconBrackets
