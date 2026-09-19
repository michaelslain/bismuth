import type { JSX } from 'solid-js'
import { Modal } from '../ui/Modal'
import { IconButton } from '../ui/IconButton'
import Heading from '../ui/Heading'
import styles from './CardsModal.module.css'

export type CardsModalProps = {
    title: string
    onClose: () => void
    /** Renders after the title, before the spacer — e.g. EditCardsModal's deck-name meta. */
    meta?: JSX.Element
    /** Merged onto the panel alongside the base sizing class, e.g. a narrower fixed-height variant. */
    class?: string
    label?: string
    children: JSX.Element
}

/**
 * Shared modal shell for the flashcards deck-wide card manager (EditCardsModal) and the
 * single-card edit modal (FlashcardsView) — extracted because both drew an identical
 * title-bar + close-button header on an identically-sized panel from what used to be one
 * shared stylesheet (bases/Flashcards.module.css), which is exactly the "second importer"
 * case the codebase's CSS Modules rule forbids. Sizing/layout only — chrome (background,
 * border, radius, shadow) still comes from ui/Modal's own `.asc-modal` class.
 */
const CardsModal = (props: CardsModalProps) => {
    return (
        <Modal
            onClose={props.onClose}
            label={props.label ?? props.title}
            class={`${styles.panel} ${props.class ?? ''}`}
        >
            <div class={styles.head}>
                <Heading level={2} class={styles.title}>
                    {props.title}
                </Heading>
                {props.meta}
                <div class={styles.sp} />
                <IconButton icon="X" label="Close" onClick={props.onClose} />
            </div>
            {props.children}
        </Modal>
    )
}

export default CardsModal
