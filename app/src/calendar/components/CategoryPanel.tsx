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
                            onRename={(name, next) =>
                                void renameCategory(props.store, name, next)
                            }
                            onRecolor={(name, color) =>
                                void recolorCategory(props.store, name, color)
                            }
                            onDelete={name =>
                                void deleteCategoryWithUndo(props.store, name)
                            }
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
