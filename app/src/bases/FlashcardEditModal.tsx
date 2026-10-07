import { createSignal, type Component } from 'solid-js'
import FormModal from '../ui/FormModal'
import ModalBody from '../ui/ModalBody'
import ModalFooter from '../ui/ModalFooter'
import ModalHeader from '../ui/ModalHeader'
import SettingsField from '../ui/SettingsField'
import SettingsGrid from '../ui/SettingsGrid'
import { TextButton } from '../ui/TextButton'
import { TextInput } from '../ui/TextInput'
import styles from './FlashcardEditModal.module.css'

export type FlashcardEditModalProps = {
    /** The card's prompt as it stands. Read once, when the modal opens: the fields are a draft,
     *  so a refetch under an open dialog must not rewrite what the user is typing. */
    front: string
    /** The card's answer, read once like `front`. */
    back: string
    /** Commit the draft. The caller writes it and closes the dialog. */
    onSave: (front: string, back: string) => void | Promise<void>
    onClose: () => void
}

/**
 * Edit one flashcard's front and back, opened from the review stage's per-card actions (the
 * deck-wide browse/add/delete dialog is `EditCardsModal`). Mount it only while open — each mount
 * starts a fresh draft from `front`/`back`.
 */
const FlashcardEditModal: Component<FlashcardEditModalProps> = props => {
    // Initial values only — see the prop docs; the draft deliberately does not follow the props.
    const [front, setFront] = createSignal(props.front)
    const [back, setBack] = createSignal(props.back)
    return (
        <FormModal onClose={() => props.onClose()} label="edit card" width={420}>
            <ModalHeader title="edit card" onClose={() => props.onClose()} />
            <ModalBody>
                <SettingsGrid>
                    <SettingsField label="front">
                        <TextInput
                            multiline
                            class={styles.cardField}
                            value={front()}
                            placeholder="Front / prompt…"
                            onInput={setFront}
                        />
                    </SettingsField>
                    <SettingsField label="back">
                        <TextInput
                            multiline
                            class={styles.cardField}
                            value={back()}
                            placeholder="Back / answer…"
                            onInput={setBack}
                        />
                    </SettingsField>
                </SettingsGrid>
            </ModalBody>
            <ModalFooter>
                <TextButton onClick={() => props.onClose()}>cancel</TextButton>
                <TextButton primary onClick={() => void props.onSave(front(), back())}>
                    save
                </TextButton>
            </ModalFooter>
        </FormModal>
    )
}

export default FlashcardEditModal
