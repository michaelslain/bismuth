import {
    createSignal,
    createEffect,
    onCleanup,
    onMount,
    For,
    Show,
} from 'solid-js'
import { categories, showCategoryPanel } from '../state'
import { EventStore } from '../EventStore'
import { settings } from '../../settings'
import FormModal from '../../ui/FormModal'
import ModalBody from '../../ui/ModalBody'
import Text from '../../ui/Text'
import { Icon } from '../../icons/Icon'
import { TextInput } from '../../ui/TextInput'
import { TextButton } from '../../ui/TextButton'
import { IconButton } from '../../ui/IconButton'
import { IconTextButton } from '../../ui/IconTextButton'
import ModalHeader from '../../ui/ModalHeader'
import ModalFooter from '../../ui/ModalFooter'
import ColorChip from '../../ui/ColorChip'
import styles from './CategoryPanel.module.css'

export function CategoryPanel(props: { store: EventStore }) {
    const [newName, setNewName] = createSignal('')
    const [newColor, setNewColor] = createSignal(
        settings.calendar.defaultCategoryColor,
    )
    // which colour popover is open: a category name, the literal 'new', or null
    const [picker, setPicker] = createSignal<string | null>(null)
    // which category is being renamed inline (its current name), or null
    const [editName, setEditName] = createSignal<string | null>(null)

    const close = () => (showCategoryPanel.value = false)

    async function handleAdd(): Promise<void> {
        const name = newName().trim()
        if (!name || categories.value.some(c => c.name === name)) return
        await props.store.addCategory({ name, color: newColor() })
        categories.value = props.store.getCategories()
        setNewName('')
        setNewColor(settings.calendar.defaultCategoryColor)
    }

    async function handleDelete(name: string): Promise<void> {
        const reassign = categories.value.find(
            c =>
                c.name !== name &&
                (c.name === 'Uncategorized' || c.name === 'Default'),
        )?.name
        await props.store.deleteCategory(name, reassign)
        categories.value = props.store.getCategories()
    }

    async function handleColorChange(
        name: string,
        color: string,
    ): Promise<void> {
        await props.store.updateCategory(name, { color })
        categories.value = props.store.getCategories()
    }

    async function handleRename(oldName: string, raw: string): Promise<void> {
        const name = raw.trim()
        setEditName(null)
        if (
            !name ||
            name === oldName ||
            categories.value.some(c => c.name === name)
        )
            return
        await props.store.updateCategory(oldName, { name })
        categories.value = props.store.getCategories()
    }

    onMount(() => {
        // Escape-to-close is handled by <Modal>; this keeps Enter-to-add when not renaming.
        function onKey(e: KeyboardEvent): void {
            const tag = (e.target as HTMLElement)?.tagName
            if (
                e.key === 'Enter' &&
                tag !== 'TEXTAREA' &&
                tag !== 'SELECT' &&
                editName() === null
            ) {
                e.preventDefault()
                handleAdd()
            }
        }
        window.addEventListener('keydown', onKey)
        onCleanup(() => window.removeEventListener('keydown', onKey))
    })

    // Close an open colour popover when clicking anywhere outside a chip/popover.
    // ColorChip's wrapper stops `mousedown` from ever bubbling out of its own subtree
    // (see its comment), so any mousedown that reaches this window listener at all is,
    // by construction, outside every chip/popover — no DOM interrogation needed here.
    createEffect(() => {
        if (picker() === null) return
        const onDown = () => setPicker(null)
        window.addEventListener('mousedown', onDown)
        onCleanup(() => window.removeEventListener('mousedown', onDown))
    })

    return (
        <Show when={showCategoryPanel.value}>
            <FormModal onClose={close} label="categories" class={styles.panel}>
                <ModalHeader title="categories" onClose={close} />

                <ModalBody>
                    {/* existing categories — compact rows, one chip each */}
                    <Show when={categories.value.length}>
                        <div class={styles['cat-group']}>
                            <For each={categories.value}>
                                {c => (
                                    <div class={styles['cat-row']}>
                                        <ColorChip
                                            color={c.color}
                                            open={picker() === c.name}
                                            onToggle={() =>
                                                setPicker(p =>
                                                    p === c.name
                                                        ? null
                                                        : c.name,
                                                )
                                            }
                                            onPick={col => {
                                                handleColorChange(c.name, col)
                                                setPicker(null)
                                            }}
                                        />
                                        <Show
                                            when={editName() === c.name}
                                            fallback={
                                                <Text
                                                    as="span"
                                                    size="inherit"
                                                    tone="inherit"
                                                    weight="inherit"
                                                    class={styles['cat-name']}
                                                    title="Double-click to rename"
                                                    onDblClick={() => {
                                                        setPicker(null)
                                                        setEditName(c.name)
                                                    }}
                                                >
                                                    {c.name}
                                                </Text>
                                            }
                                        >
                                            <TextInput
                                                plain
                                                class={styles['cat-nameedit']}
                                                value={c.name}
                                                onInput={() => {}}
                                                ref={el =>
                                                    queueMicrotask(() => {
                                                        el.focus()
                                                        el.select()
                                                    })
                                                }
                                                onBlur={e =>
                                                    handleRename(
                                                        c.name,
                                                        e.currentTarget.value,
                                                    )
                                                }
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        handleRename(
                                                            c.name,
                                                            e.currentTarget
                                                                .value,
                                                        )
                                                    } else if (
                                                        e.key === 'Escape'
                                                    ) {
                                                        e.preventDefault()
                                                        setEditName(null)
                                                    }
                                                }}
                                            />
                                        </Show>
                                        <IconButton
                                            icon="x"
                                            label={'Delete ' + c.name}
                                            iconSize={14}
                                            danger
                                            onClick={() => {
                                                handleDelete(c.name)
                                                setPicker(null)
                                            }}
                                        />
                                    </div>
                                )}
                            </For>
                        </div>
                    </Show>

                    {/* new category — separated dashed card */}
                    <div class={styles['cat-add']}>
                        <div class={styles['cat-add-head']}>
                            <Icon value="plus" size={12} strokeWidth={2.2} />
                            new category
                        </div>
                        <div class={styles['cat-newrow']}>
                            <ColorChip
                                color={newColor()}
                                open={picker() === 'new'}
                                up
                                onToggle={() =>
                                    setPicker(p => (p === 'new' ? null : 'new'))
                                }
                                onPick={col => {
                                    setNewColor(col)
                                    setPicker(null)
                                }}
                            />
                            <TextInput
                                class={styles['cat-input']}
                                placeholder="category name"
                                value={newName()}
                                onInput={setNewName}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleAdd()
                                }}
                            />
                            <IconTextButton
                                icon="Plus"
                                variant="selected"
                                onClick={handleAdd}
                            >
                                add
                            </IconTextButton>
                        </div>
                    </div>
                </ModalBody>

                <ModalFooter hint="close">
                    <TextButton primary onClick={close}>
                        done
                    </TextButton>
                </ModalFooter>
            </FormModal>
        </Show>
    )
}
