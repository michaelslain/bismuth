// A kanban column header's `…` menu — Rename and Delete. Self-contained: owns its own trigger
// button, anchored popover and (for Rename) the inline text-input step (KanbanColumnNameInput,
// shared with KanbanAddColumn's field), so KanbanView only wires `onRename`/`onDelete` and never
// touches the popover's open state. Delete is offered only for an empty column (`canDelete`),
// matching the "delete only when empty" acceptance — a non-empty column shows the row disabled
// with a reason rather than hiding it outright (so a hover/focus user learns WHY, not just that
// it's missing).
//
// The trigger is faint until the column header is hovered or something inside the header has
// keyboard focus — KanbanView.module.css's `.kanbanColHeader:hover [data-kbcolmenu-trigger]` /
// `:focus-within` rule does that (a `data-*` runtime hook, not a class, so it crosses the
// component boundary the same way `data-kbcol`/`data-kbcard` already do elsewhere in this view).
import { createSignal, Show, type Component } from 'solid-js'
import AnchoredPopover from '../ui/AnchoredPopover'
import PopoverList from '../ui/popover/PopoverList'
import IconButton from '../ui/IconButton'
import KanbanColumnNameInput from './KanbanColumnNameInput'
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
    let triggerRef: HTMLButtonElement | undefined

    function close(): void {
        setMode('closed')
    }

    return (
        <>
            <IconButton
                ref={el => (triggerRef = el)}
                icon="Menu"
                label="Column menu"
                class={`${styles.trigger}${props.className ? ` ${props.className}` : ''}`}
                data-kbcolmenu-trigger
                aria-haspopup="menu"
                aria-expanded={mode() !== 'closed'}
                onClick={() => setMode(mode() === 'closed' ? 'menu' : 'closed')}
            />
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
                                { label: 'rename' },
                                {
                                    label: 'delete',
                                    danger: props.canDelete,
                                    disabled: !props.canDelete,
                                    detail: props.canDelete
                                        ? undefined
                                        : 'column not empty',
                                },
                            ]}
                            onActivate={i => {
                                if (i === 0) setMode('rename')
                                else if (i === 1 && props.canDelete) {
                                    props.onDelete()
                                    close()
                                }
                            }}
                        />
                    }
                >
                    <KanbanColumnNameInput
                        className={styles.renaming}
                        initial={props.name}
                        existing={props.existing}
                        selectOnMount
                        onSubmit={to => {
                            props.onRename(to)
                            close()
                        }}
                        onCancel={close}
                    />
                </Show>
            </AnchoredPopover>
        </>
    )
}

export default KanbanColumnMenu
