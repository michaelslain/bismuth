// app/src/bases/ViewTabs.tsx
// The base's view-tab strip — the SegmentedToggle-look row BaseView used to render inline,
// pulled out because it now does much more than select a tab: add/rename/duplicate/reorder/
// change-kind/toggle-mode/delete a view, and open its settings, all from the strip itself.
// BaseView still owns every WRITE (the pure edits live in ./viewsEdit.ts, the network call in
// BaseView.tsx) — this component only reports gestures upward via its callback props.
//
// Two registers. `editable` (a real `type: base` file BaseView can rewrite) gets the full
// treatment: dblclick-to-rename, right-click / Shift+F10 / the ContextMenu key for the action
// menu, and a trailing "+" that adds a view. A non-editable base (an embedded ```query block,
// which has no `editPath` to write to) renders the SAME look with none of that wired — "plain
// tabs as today".
import { createSignal, For, Show, type Component } from 'solid-js'
import type { ViewType } from '../../../core/src/bases/types'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { openContextMenu } from '../nativeMenu'
import { addMenuItems, tabMenuItems } from './viewTabMenu'
import { TextButton } from '../ui/TextButton'
import { IconButton } from '../ui/IconButton'
import InlineTextInput from '../ui/InlineTextInput'
import styles from './ViewTabs.module.css'
import { isMenuKey } from '../ui/widgetKeys'

export type ViewTabInfo = {
    name: string
    type: ViewType
    mode: 'normal' | 'tasks'
}

export type ViewTabsProps = {
    views: ViewTabInfo[]
    active: number
    onSelect: (i: number) => void
    /** False for an embedded ```query block (no base file to rewrite) — renders plain
     *  SegmentedToggle-look tabs with no rename/menu/add affordance. */
    editable: boolean
    onAdd: (type: ViewType) => void
    onRename: (i: number, name: string) => void
    onDuplicate: (i: number) => void
    onDelete: (i: number) => void
    onMove: (i: number, dir: -1 | 1) => void
    onChangeType: (i: number, type: ViewType) => void
    onToggleMode: (i: number) => void
    onOpenSettings: (i: number) => void
    class?: string
}

const ViewTabs: Component<ViewTabsProps> = props => {
    const [renaming, setRenaming] = createSignal<number | null>(null)
    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        items: MenuItem[]
    } | null>(null)

    const tabMenu = (i: number) =>
        tabMenuItems(props.views, i, {
            onRename: setRenaming,
            onDuplicate: props.onDuplicate,
            onChangeType: props.onChangeType,
            onToggleMode: props.onToggleMode,
            onMove: props.onMove,
            onOpenSettings: props.onOpenSettings,
            onDelete: props.onDelete,
        })

    const openTabMenu = (i: number, x: number, y: number) =>
        openContextMenu(x, y, tabMenu(i), setMenu)

    return (
        <div class={`${styles.tabs} ${props.class ?? ''}`} data-view-tabs="">
            <For each={props.views}>
                {(v, i) => (
                    <Show
                        when={renaming() === i()}
                        fallback={
                            <TextButton
                                variant={
                                    i() === props.active
                                        ? 'selected'
                                        : 'unselected'
                                }
                                onClick={() => props.onSelect(i())}
                                onDblClick={() => {
                                    if (props.editable) setRenaming(i())
                                }}
                                onContextMenu={e => {
                                    if (!props.editable) return
                                    e.preventDefault()
                                    openTabMenu(i(), e.clientX, e.clientY)
                                }}
                                onKeyDown={e => {
                                    if (!props.editable || !isMenuKey(e)) return
                                    e.preventDefault()
                                    const r =
                                        e.currentTarget.getBoundingClientRect()
                                    openTabMenu(i(), r.left, r.bottom)
                                }}
                            >
                                {v.name}
                            </TextButton>
                        }
                    >
                        <InlineTextInput
                            class={styles.rename}
                            value={v.name}
                            label={`Rename ${v.name} view`}
                            onCommit={name => {
                                setRenaming(null)
                                if (name) props.onRename(i(), name)
                            }}
                            onCancel={() => setRenaming(null)}
                        />
                    </Show>
                )}
            </For>
            <Show when={props.editable}>
                <IconButton
                    icon="Plus"
                    label="Add view"
                    size="sm"
                    onClick={e => {
                        const r = e.currentTarget.getBoundingClientRect()
                        openContextMenu(
                            r.left,
                            r.bottom,
                            addMenuItems(props.onAdd),
                            setMenu,
                        )
                    }}
                />
            </Show>
            <Show when={menu()}>
                {m => (
                    <ContextMenu
                        x={m().x}
                        y={m().y}
                        items={m().items}
                        onClose={() => setMenu(null)}
                    />
                )}
            </Show>
        </div>
    )
}

export default ViewTabs
