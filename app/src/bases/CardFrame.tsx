import type { Component, JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import styles from './CardFrame.module.css'

export type CardFrameProps = {
    /** 'note' (default) is the book-cover/body card frame; 'task' is the slimmer
     *  TaskChip-register box used by a tasks-mode card. */
    kind?: 'note' | 'task'
    /** CardsView's click-to-open look: pointer cursor + accent-border/hover-bg wash. */
    interactive?: boolean
    /** KanbanView's pointer-drag look: grab cursor, no text-select, no scroll steal. */
    draggable?: boolean
    /** KanbanView's image-file drop target: solid accent ring + soft accent wash. */
    dropTarget?: boolean
    class?: string
    classList?: Record<string, boolean | undefined>
    children?: JSX.Element
} & JSX.HTMLAttributes<HTMLDivElement>

/**
 * The shared "card" frame — background/border/radius/overflow — reused by CardsView's book-cover
 * grid and KanbanView's board. Extracted because both views imported the SAME unqualified `.card`/
 * `.taskCard` rule out of the old bases/BaseView.module.css; the context-specific look (click-to-
 * open vs. draggable vs. drop-target) is now a prop on this component rather than a descendant
 * selector reaching into a class the caller doesn't own.
 */
const CardFrame: Component<CardFrameProps> = props => {
    const [local, rest] = splitProps(props, [
        'kind',
        'interactive',
        'draggable',
        'dropTarget',
        'class',
        'classList',
        'children',
    ])
    return (
        <div
            class={`${local.kind === 'task' ? styles.taskCard : styles.card} ${local.class ?? ''}`}
            classList={{
                [styles.interactive]: !!local.interactive,
                [styles.draggable]: !!local.draggable,
                [styles.dropTarget]: !!local.dropTarget,
                ...local.classList,
            }}
            {...rest}
        >
            {local.children}
        </div>
    )
}

export default CardFrame
