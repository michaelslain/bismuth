// Visual spec for <ViewTabs> — the base's view-tab strip: SegmentedToggle-look tabs plus
// add/rename/duplicate/reorder/change-kind/toggle-mode/delete, gated on `editable`.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ViewTabs, { type ViewTabInfo } from './ViewTabs'

const noop = () => {}

const meta = {
    title: 'Bases/ViewTabs',
    component: ViewTabs,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ViewTabs>

export default meta
type Story = StoryObj<typeof meta>

const THREE_VIEWS: ViewTabInfo[] = [
    { name: 'Table', type: 'table', mode: 'normal' },
    { name: 'Board', type: 'kanban', mode: 'tasks' },
    { name: 'Calendar', type: 'calendar', mode: 'normal' },
]

const handlers = {
    onSelect: noop,
    onAdd: noop,
    onRename: noop,
    onDuplicate: noop,
    onDelete: noop,
    onMove: noop,
    onChangeType: noop,
    onToggleMode: noop,
    onOpenSettings: noop,
}

/** A real base file: full affordances — rename/menu/add. */
export const Editable: Story = {
    args: {
        views: THREE_VIEWS,
        active: 1,
        editable: true,
        ...handlers,
    },
}

/** Editable with only one view — the strip still shows so "+" stays reachable. */
export const SingleView: Story = {
    args: {
        views: [THREE_VIEWS[0]],
        active: 0,
        editable: true,
        ...handlers,
    },
}

/** An embedded ```query block — no editPath, so no rename/menu/add: plain tabs. */
export const NotEditable: Story = {
    args: {
        views: THREE_VIEWS,
        active: 0,
        editable: false,
        ...handlers,
    },
}

/** Right-click a tab to see the action menu (rename / duplicate / change kind ▸ / tasks mode /
 *  move / view settings / delete ▸ confirm delete). Storybook's static shot won't show the
 *  open menu, but the row underneath renders identically to Editable. */
export const ManyViews: Story = {
    args: {
        views: [
            { name: 'Table', type: 'table', mode: 'normal' },
            { name: 'Cards', type: 'cards', mode: 'normal' },
            { name: 'Board', type: 'kanban', mode: 'tasks' },
            { name: 'Calendar', type: 'calendar', mode: 'normal' },
            { name: 'Deck', type: 'flashcards', mode: 'normal' },
        ],
        active: 2,
        editable: true,
        ...handlers,
    },
}
