import type { Component, JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import Card from '../ui/Card'
import DropCue from '../ui/DropCue'
import styles from './CardFrame.module.css'

export type CardFrameProps = {
    /** 'note' (default) is the book-cover/body card frame; 'task' is the slimmer
     *  TaskChip-register box used by a tasks-mode card. */
    kind?: 'note' | 'task'
    /** CardsView's click-to-open look: pointer cursor + accent-border/hover-bg wash. */
    interactive?: boolean
    /** KanbanView's pointer-drag look: grab cursor, no text-select, no scroll steal. */
    draggable?: boolean
    /** KanbanView's image-file drop target: an accent border plus the shared `DropCue`. */
    dropTarget?: boolean
    /** 'hidden' (default) clips the frame's children to its box, which is what a book cover
     *  needs. 'visible' lets a child overflow it — a body card hosts a CodeMirror editor whose
     *  completion popup would otherwise be cut off at the card's edge. */
    overflow?: 'visible' | 'hidden'
    class?: string
    classList?: Record<string, boolean | undefined>
    children?: JSX.Element
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'class' | 'classList' | 'children'>

/**
 * The shared "card" frame, reused by CardsView's book-cover grid, BodyCard and KanbanView's board.
 * It composes `ui/Card` (the flat bordered surface) and only adds what a bases card needs on top:
 * no padding of its own (the cover runs edge to edge), the soft rule, the click-to-open /
 * drag / drop looks, and the `overflow` choice. The context-specific look is a prop on this
 * component rather than a descendant selector reaching into a class the caller doesn't own.
 */
const CardFrame: Component<CardFrameProps> = props => {
    const [local, rest] = splitProps(props, [
        'kind',
        'interactive',
        'draggable',
        'dropTarget',
        'overflow',
        'class',
        'classList',
        'children',
    ])
    const extra = () =>
        Object.entries(local.classList ?? {})
            .filter(([, on]) => on)
            .map(([name]) => name)
    const cls = () =>
        [
            local.kind === 'task' ? styles.task : styles.note,
            local.overflow === 'visible' ? styles.overflowVisible : '',
            local.interactive ? styles.interactive : '',
            local.draggable ? styles.draggable : '',
            local.dropTarget ? styles.dropTarget : '',
            local.class,
            ...extra(),
        ]
            .filter(Boolean)
            .join(' ')
    return (
        <Card {...rest} class={cls()}>
            {local.children}
            <DropCue active={!!local.dropTarget} />
        </Card>
    )
}

export default CardFrame
