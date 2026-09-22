// A kanban column header's `…` menu — Rename and Delete. Self-contained: owns its own trigger
// button, anchored popover and (for Rename) the inline text-input step, so KanbanView only wires
// `onRename`/`onDelete` and never touches the popover's open state. Delete is offered only for an
// empty column (`canDelete`), matching the "delete only when empty" acceptance — a non-empty
// column shows the row disabled with a reason rather than hiding it outright (so a hover/focus
// user learns WHY, not just that it's missing).
//
// The trigger is faint until the column header is hovered or something inside the header has
// keyboard focus — KanbanView.module.css's `.kanbanColHeader:hover [data-kbcolmenu-trigger]` /
// `:focus-within` rule does that (a `data-*` runtime hook, not a class, so it crosses the
// component boundary the same way `data-kbcol`/`data-kbcard` already do elsewhere in this view).
import { createSignal, Show, type Component } from 'solid-js'
import AnchoredPopover from '../ui/AnchoredPopover'
import PopoverList from '../ui/popover/PopoverList'
import PlainButton from '../ui/PlainButton'
import Text from '../ui/Text'
import TextInput from '../ui/TextInput'
import { isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import styles from './KanbanColumnMenu.module.css'

export type KanbanColumnMenuProps = {
    /** The column's current key/name, prefilled into the rename field. */
    name: string
    /** Whether Delete is currently allowed (the column has no cards). */
    canDelete: boolean
    /** Every OTHER column's key — a rename to one of these is refused inline, same as
     *  KanbanAddColumn's duplicate-name check. */
    existing: string[]
    onRename: (to: string) => void
    onDelete: () => void
    className?: string
}

const KanbanColumnMenu: Component<KanbanColumnMenuProps> = props => {
    const [mode, setMode] = createSignal<'closed' | 'menu' | 'rename'>('closed')
    const [value, setValue] = createSignal('')
    const [error, setError] = createSignal<string | null>(null)
    let triggerRef: HTMLButtonElement | undefined

    function close(): void {
        setMode('closed')
        setError(null)
    }

    function startRename(): void {
        setValue(props.name)
        setError(null)
        setMode('rename')
    }

    function submitRename(): void {
        const trimmed = value().trim()
        if (trimmed === '' || trimmed === props.name) {
            close()
            return
        }
        if (props.existing.includes(trimmed)) {
            setError('already a column')
            return
        }
        props.onRename(trimmed)
        close()
    }

    return (
        <>
            <PlainButton
                ref={el => (triggerRef = el)}
                class={`${styles.trigger}${props.className ? ` ${props.className}` : ''}`}
                data-kbcolmenu-trigger
                aria-haspopup="menu"
                aria-expanded={mode() !== 'closed'}
                aria-label="Column menu"
                title="Column menu"
                onClick={() => setMode(mode() === 'closed' ? 'menu' : 'closed')}
            >
                <Text as="span" size="inherit" tone="inherit" weight="inherit">
                    …
                </Text>
            </PlainButton>
            <AnchoredPopover
                anchor={() => triggerRef}
                open={mode() !== 'closed'}
                onDismiss={close}
                panelAttrs={{ 'data-testid': 'kanban-column-menu' }}
            >
                <Show
                    when={mode() === 'rename'}
                    fallback={
                        <PopoverList
                            items={[
                                { label: 'Rename' },
                                {
                                    label: 'Delete',
                                    danger: true,
                                    disabled: !props.canDelete,
                                    detail: props.canDelete
                                        ? undefined
                                        : 'column not empty',
                                },
                            ]}
                            onActivate={i => {
                                if (i === 0) startRename()
                                else if (i === 1 && props.canDelete) {
                                    props.onDelete()
                                    close()
                                }
                            }}
                        />
                    }
                >
                    <div class={styles.renaming}>
                        <TextInput
                            plain
                            class={styles.input}
                            value={value()}
                            ref={el =>
                                queueMicrotask(() => {
                                    el.focus()
                                    el.select()
                                })
                            }
                            onInput={v => {
                                setValue(v)
                                setError(null)
                            }}
                            onKeyDown={e => {
                                if (isConfirmKey(e)) {
                                    e.preventDefault()
                                    submitRename()
                                } else if (isDismissKey(e)) {
                                    close()
                                }
                            }}
                            onBlur={() => {
                                if (value().trim() === '') close()
                            }}
                        />
                        <Show when={error()}>
                            <Text as="span" size="micro" class={styles.error}>
                                {error()}
                            </Text>
                        </Show>
                    </div>
                </Show>
            </AnchoredPopover>
        </>
    )
}

export default KanbanColumnMenu
export { KanbanColumnMenu }
