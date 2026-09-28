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
import { BASE_VIEW_KINDS } from '../baseViews'
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

    const kindItems = (i: number): MenuItem[] =>
        BASE_VIEW_KINDS.filter(k => k.view !== props.views[i].type).map(k => ({
            label: k.label,
            icon: k.icon,
            onSelect: () => props.onChangeType(i, k.view as ViewType),
        }))

    const tabMenuItems = (i: number): MenuItem[] => {
        const v = props.views[i]
        return [
            { label: 'rename', icon: 'Pencil', onSelect: () => setRenaming(i) },
            {
                label: 'duplicate',
                icon: 'Copy',
                onSelect: () => props.onDuplicate(i),
            },
            { label: 'change kind', icon: 'Table', submenu: kindItems(i) },
            {
                label:
                    v.mode === 'tasks'
                        ? 'turn off tasks mode'
                        : 'turn on tasks mode',
                icon: 'ListChecks',
                onSelect: () => props.onToggleMode(i),
            },
            {
                label: 'move left',
                icon: 'ArrowLeft',
                disabled: i === 0,
                onSelect: () => props.onMove(i, -1),
            },
            {
                label: 'move right',
                icon: 'ArrowRight',
                disabled: i === props.views.length - 1,
                onSelect: () => props.onMove(i, 1),
            },
            {
                label: 'view settings',
                icon: 'Settings',
                onSelect: () => props.onOpenSettings(i),
            },
            {
                label: 'delete',
                icon: 'Trash2',
                danger: true,
                // Never offers to drop the last view. No confirm() — a nested "confirm delete"
                // row is the confirmation, the same submenu mechanic as "change kind".
                disabled: props.views.length <= 1,
                submenu: [
                    {
                        label: 'confirm delete',
                        danger: true,
                        onSelect: () => props.onDelete(i),
                    },
                ],
            },
        ]
    }

    const openTabMenu = (i: number, x: number, y: number) =>
        openContextMenu(x, y, tabMenuItems(i), setMenu)

    const addMenuItems: MenuItem[] = BASE_VIEW_KINDS.map(k => ({
        label: k.label,
        icon: k.icon,
        onSelect: () => props.onAdd(k.view as ViewType),
    }))

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
                        openContextMenu(r.left, r.bottom, addMenuItems, setMenu)
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
