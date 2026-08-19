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
import { Modal } from '../../ui/Modal'
import { Icon } from '../../icons/Icon'
import { TextInput } from '../../ui/TextInput'
import { TextButton } from '../../ui/TextButton'
import { IconTextButton } from '../../ui/IconTextButton'
import { THEME_SWATCHES, resolveCategoryColor } from '../categoryColor'
import styles from '../Calendar.module.css'

/** Palette popover: the six token swatches + accent (PALETTE_TOKENS) — token-driven,
 *  no custom hex wheel. A category already on a non-token colour (set before this
 *  redesign) just shows no swatch highlighted; picking any swatch here replaces it. */
function Palette(props: {
    value: string
    onPick: (c: string) => void
    up?: boolean
}) {
    return (
        <div
            class={`${styles['cat-pop']}${props.up ? ` ${styles['up']}` : ''}`}
            onClick={e => e.stopPropagation()}
        >
            <div class={styles['cat-sws']}>
                <For each={THEME_SWATCHES}>
                    {tok => (
                        <button
                            type="button"
                            class={`${styles['cat-sw']}${props.value === tok ? ` ${styles['on']}` : ''}`}
                            style={{
                                color: `var(--${tok})`,
                                background: `var(--${tok})`,
                            }}
                            title={tok}
                            aria-label={tok}
                            onClick={() => props.onPick(tok)}
                        />
                    )}
                </For>
            </div>
        </div>
    )
}

function ColorChip(props: {
    color: string
    open: boolean
    up?: boolean
    onToggle: () => void
    onPick: (c: string) => void
}) {
    // Stopping `mousedown` here (not `click`) is what actually matters: the panel's
    // outside-click guard below listens for `mousedown` on window, so this is the event
    // that must never leave this subtree. Stopping it declares "this press is mine" to
    // the guard without the guard ever needing to interrogate the DOM for a class name —
    // so nothing here breaks when this file's classes become CSS-module hashed locals.
    return (
        <div class={styles['cat-chipwrap']} onMouseDown={e => e.stopPropagation()}>
            <button
                type="button"
                class={`${styles['cat-chip']}${props.open ? ` ${styles['open']}` : ''}`}
                style={{ background: resolveCategoryColor(props.color) }}
                aria-label="Choose colour"
                onClick={e => {
                    e.stopPropagation()
                    props.onToggle()
                }}
            />
            <Show when={props.open}>
                <Palette
                    value={props.color}
                    onPick={props.onPick}
                    up={props.up}
                />
            </Show>
        </div>
    )
}

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
            <Modal onClose={close} class={`${styles['category-panel']} ${styles['evm-modal']}`}>
                <div class={styles['evm-head']}>
                    <div class={styles['evm-mark']}>
                        <Icon value="tags" size={18} />
                    </div>
                    <div class={styles['evm-htext']}>
                        <div class={styles['evm-title']}>Categories</div>
                    </div>
                    <button
                        type="button"
                        class={styles['evm-x']}
                        aria-label="Close"
                        onClick={close}
                    >
                        <Icon value="x" size={16} />
                    </button>
                </div>

                <div class={styles['evm-body']}>
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
                                                <span
                                                    class={styles['cat-name']}
                                                    title="Double-click to rename"
                                                    onDblClick={() => {
                                                        setPicker(null)
                                                        setEditName(c.name)
                                                    }}
                                                >
                                                    {c.name}
                                                </span>
                                            }
                                        >
                                            <input
                                                class={styles['cat-nameedit']}
                                                value={c.name}
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
                                        <button
                                            class={styles['cat-del']}
                                            aria-label={'Delete ' + c.name}
                                            onClick={() => {
                                                handleDelete(c.name)
                                                setPicker(null)
                                            }}
                                        >
                                            <Icon value="x" size={14} />
                                        </button>
                                    </div>
                                )}
                            </For>
                        </div>
                    </Show>

                    {/* new category — separated dashed card */}
                    <div class={styles['cat-add']}>
                        <div class={styles['cat-add-head']}>
                            <Icon value="plus" size={12} strokeWidth={2.2} />
                            New category
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
                                placeholder="Category name"
                                value={newName()}
                                onInput={setNewName}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleAdd()
                                }}
                            />
                            <IconTextButton
                                icon="Plus"
                                size="sm"
                                variant="selected"
                                onClick={handleAdd}
                            >
                                ADD
                            </IconTextButton>
                        </div>
                    </div>
                </div>

                <div class={styles['evm-foot']}>
                    <span class={styles['hintkey']}>
                        <b>esc</b> to close
                    </span>
                    <div class={styles['sp']} />
                    <TextButton size="sm" variant="selected" onClick={close}>
                        DONE
                    </TextButton>
                </div>
            </Modal>
        </Show>
    )
}
