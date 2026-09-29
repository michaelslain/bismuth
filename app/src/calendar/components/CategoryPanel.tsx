import { Show } from 'solid-js'
import { categories, showCategoryPanel } from '../state'
import { EventStore } from '../EventStore'
import {
    addCategory,
    deleteCategoryWithUndo,
    recolorCategory,
    renameCategory,
} from '../categoryActions'
import FormModal from '../../ui/FormModal'
import ModalBody from '../../ui/ModalBody'
import { TextButton } from '../../ui/TextButton'
import ModalHeader from '../../ui/ModalHeader'
import ModalFooter from '../../ui/ModalFooter'
import SettingsHint from '../../ui/SettingsHint'
import { pushToast } from '../../toastStore'
import CategoryList from './CategoryList'
import NewCategoryForm from './NewCategoryForm'

export function CategoryPanel(props: { store: EventStore }) {
    const close = () => (showCategoryPanel.value = false)

    return (
        <Show when={showCategoryPanel.value}>
            <FormModal onClose={close} label="categories">
                <ModalHeader title="categories" onClose={close} />

                <ModalBody>
                    <Show
                        when={categories.value.length}
                        fallback={<SettingsHint>no categories yet</SettingsHint>}
                    >
                        <CategoryList
                            categories={categories.value}
                            onRename={async (name, next) => {
                                try {
                                    await renameCategory(props.store, name, next)
                                } catch (e) {
                                    pushToast(
                                        `Could not rename: ${(e as Error).message}`,
                                    )
                                }
                            }}
                            onRecolor={async (name, color) => {
                                try {
                                    await recolorCategory(props.store, name, color)
                                } catch (e) {
                                    pushToast(
                                        `Could not recolor: ${(e as Error).message}`,
                                    )
                                }
                            }}
                            onDelete={async name => {
                                try {
                                    await deleteCategoryWithUndo(
                                        props.store,
                                        name,
                                    )
                                } catch (e) {
                                    pushToast(
                                        `Could not delete: ${(e as Error).message}`,
                                    )
                                }
                            }}
                        />
                    </Show>

                    <NewCategoryForm
                        onAdd={c => addCategory(props.store, c)}
                    />
                </ModalBody>

                <ModalFooter>
                    <TextButton primary onClick={close}>
                        done
                    </TextButton>
                </ModalFooter>
            </FormModal>
        </Show>
    )
}
