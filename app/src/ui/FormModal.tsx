import { splitProps, type Component } from 'solid-js'
import Modal, { type ModalProps } from './Modal'
import styles from './FormModal.module.css'

export type FormModalProps = Omit<ModalProps, 'class'> & {
    /** Panel width in px. 548 by default; the recurrence dialog uses 420, the query builder 600.
     *  `max-width: calc(100vw - 32px)` still caps it, so a narrow viewport never scrolls sideways. */
    width?: number
    class?: string
}

/**
 * The settings/editor modal: a <Modal> panel sized as a column of ModalHeader, ModalBody and
 * ModalFooter. Six modals (event, categories, recurrence, calendar settings, base settings, query
 * builder) used to borrow this shape as a class out of calendar/Calendar.module.css.
 */
const FormModal: Component<FormModalProps> = props => {
    const [local, rest] = splitProps(props, ['width', 'class', 'panelRef', 'children'])
    return (
        <Modal
            {...rest}
            class={local.class}
            panelClass={styles.panel}
            panelRef={el => {
                if (local.width !== undefined)
                    el.style.setProperty('--form-modal-width', `${local.width}px`)
                local.panelRef?.(el)
            }}
        >
            {local.children}
        </Modal>
    )
}

export default FormModal
