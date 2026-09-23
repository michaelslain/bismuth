import type { Component, JSX } from 'solid-js'
import styles from './ModalBody.module.css'

export type ModalBodyProps = {
    /** A tighter cap than the panel's own, e.g. the query builder's `min(72vh, 720px)`. */
    maxHeight?: string
    class?: string
    children: JSX.Element
}

/** The scrolling content column between a ModalHeader and a ModalFooter. */
const ModalBody: Component<ModalBodyProps> = props => (
    <div
        class={[styles.body, props.class ?? ''].filter(Boolean).join(' ')}
        style={props.maxHeight ? { 'max-height': props.maxHeight } : undefined}
        data-modal-body
        data-testid="modal-body"
    >
        {props.children}
    </div>
)

export default ModalBody
