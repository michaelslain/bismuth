// The view-tab strip's menu builders — pure data, no framework runtime. ViewTabs owns the
// gestures and the ContextMenu; this owns WHICH rows a tab's menu (and the `[+]` add menu)
// offers, and which of them are disabled, so the rules are testable without a DOM.
import type { ViewType } from '../../../core/src/bases/types'
import type { MenuItem } from '../ContextMenu'
import { BASE_VIEW_KINDS } from '../baseViews'

export type TabMenuView = { type: ViewType; mode: 'normal' | 'tasks' }

export type TabMenuHandlers = {
    onRename: (i: number) => void
    onDuplicate: (i: number) => void
    onChangeType: (i: number, type: ViewType) => void
    onToggleMode: (i: number) => void
    onMove: (i: number, dir: -1 | 1) => void
    onOpenSettings: (i: number) => void
    onDelete: (i: number) => void
}

export function kindMenuItems(
    views: TabMenuView[],
    i: number,
    h: Pick<TabMenuHandlers, 'onChangeType'>,
): MenuItem[] {
    return BASE_VIEW_KINDS.filter(k => k.view !== views[i].type).map(k => ({
        label: k.label,
        icon: k.icon,
        onSelect: () => h.onChangeType(i, k.view as ViewType),
    }))
}

export function tabMenuItems(
    views: TabMenuView[],
    i: number,
    h: TabMenuHandlers,
): MenuItem[] {
    const v = views[i]
    return [
        { label: 'rename', icon: 'Pencil', onSelect: () => h.onRename(i) },
        { label: 'duplicate', icon: 'Copy', onSelect: () => h.onDuplicate(i) },
        { label: 'change kind', icon: 'Table', submenu: kindMenuItems(views, i, h) },
        {
            label: v.mode === 'tasks' ? 'turn off tasks mode' : 'turn on tasks mode',
            icon: 'ListChecks',
            onSelect: () => h.onToggleMode(i),
        },
        {
            label: 'move left',
            icon: 'ArrowLeft',
            disabled: i === 0,
            onSelect: () => h.onMove(i, -1),
        },
        {
            label: 'move right',
            icon: 'ArrowRight',
            disabled: i === views.length - 1,
            onSelect: () => h.onMove(i, 1),
        },
        { label: 'view settings', icon: 'Settings', onSelect: () => h.onOpenSettings(i) },
        {
            label: 'delete',
            icon: 'Trash2',
            danger: true,
            // Never offers to drop the last view. Deleting is immediate: BaseView answers it with
            // an undo toast rather than a confirm step (no submenu, never confirm()).
            disabled: views.length <= 1,
            onSelect: () => h.onDelete(i),
        },
    ]
}

export function addMenuItems(onAdd: (type: ViewType) => void): MenuItem[] {
    return BASE_VIEW_KINDS.map(k => ({
        label: k.label,
        icon: k.icon,
        onSelect: () => onAdd(k.view as ViewType),
    }))
}
