// Visual spec for <ViewTabs> — the base's view-tab strip: SegmentedToggle-look tabs plus
// add/rename/duplicate/reorder/change-kind/toggle-mode/delete, gated on `editable`.
//
// The editable stories hold the views in a SIGNAL and apply every action to it, so the strip can
// be tried by hand: `[+]` really adds a tab, the right-click menu really renames/moves/deletes.
// In the app the same actions rewrite the base file's `views:` array (BaseView.tsx +
// viewsEdit.ts); here the signal stands in for that write.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { ViewType } from '../../../core/src/bases/types'
import { BASE_VIEW_KINDS } from '../baseViews'
import ViewTabs, { type ViewTabInfo, type ViewTabsProps } from './ViewTabs'
import { VIEW_KIND_OPTIONS } from './selectOptions'
import { pushUndoToast } from '../undoToast'
import { ToastHost } from '../Toast'

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

const kindLabel = (type: ViewType) =>
    BASE_VIEW_KINDS.find(k => k.view === type)?.label ??
    VIEW_KIND_OPTIONS.find(k => k.value === type)?.label ??
    type

const noop = () => {}

/** Complete, typed props for the strip. Every LiveTabs story renders with its own state, so
 *  these args only feed Storybook's controls — no cast needed. */
const tabArgs = (
    views: ViewTabInfo[],
    active: number,
    editable: boolean,
): ViewTabsProps => ({
    views,
    active,
    editable,
    onSelect: noop,
    onAdd: noop,
    onRename: noop,
    onDuplicate: noop,
    onDelete: noop,
    onMove: noop,
    onChangeType: noop,
    onToggleMode: noop,
    onOpenSettings: noop,
})

/** The context menu's rows live in the document body (a fixed popover), not the canvas. */
const menuRows = () => [
    ...document.body.querySelectorAll<HTMLElement>('.bismuth-popover-row'),
]
const menuRow = (label: string) =>
    menuRows().find(r => r.textContent?.trim() === label)
const rowDisabled = (label: string) =>
    !!menuRow(label)?.classList.contains('bismuth-popover-row--disabled')
const tabLabels = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('[data-view-tabs] button')]
        .map(b => b.textContent?.trim() ?? '')
        .filter(t => t && t !== 'Add view')
const tabButton = (root: HTMLElement, name: string) =>
    [...root.querySelectorAll<HTMLElement>('[data-view-tabs] button')].find(
        b => b.textContent?.trim() === name,
    )!
const kinds = (root: HTMLElement) =>
    root.querySelector('[data-kinds]')?.getAttribute('data-kinds')
const openMenu = async (root: HTMLElement, name: string) => {
    await userEvent.pointer({
        keys: '[MouseRight]',
        target: tabButton(root, name),
    })
    await waitFor(() => expect(menuRow('rename')).toBeTruthy())
}

/** A unique name for a new/duplicated view: "Kanban", then "Kanban 2", … */
function freshName(views: ViewTabInfo[], base: string): string {
    const taken = new Set(views.map(v => v.name))
    if (!taken.has(base)) return base
    let n = 2
    while (taken.has(`${base} ${n}`)) n++
    return `${base} ${n}`
}

/** The strip with its views in a signal — every action changes them. */
function LiveTabs(props: {
    initial: ViewTabInfo[]
    active: number
    editable?: boolean
}) {
    const [views, setViews] = createSignal(props.initial.map(v => ({ ...v })))
    const [active, setActive] = createSignal(props.active)
    const at = (i: number, patch: Partial<ViewTabInfo>) =>
        setViews(vs => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)))
    return (
        <div>
        <ViewTabs
            views={views()}
            active={active()}
            editable={props.editable ?? true}
            onSelect={setActive}
            onAdd={type => {
                setViews(vs => [
                    ...vs,
                    {
                        name: freshName(vs, kindLabel(type)),
                        type,
                        mode: 'normal',
                    },
                ])
                setActive(views().length - 1)
            }}
            onRename={(i, name) => at(i, { name })}
            onDuplicate={i => {
                setViews(vs => [
                    ...vs.slice(0, i + 1),
                    { ...vs[i], name: freshName(vs, vs[i].name) },
                    ...vs.slice(i + 1),
                ])
                setActive(i + 1)
            }}
            onDelete={i => {
                if (views().length <= 1) return
                const gone = views()[i]
                setViews(vs => vs.filter((_, j) => j !== i))
                setActive(Math.max(0, i - 1))
                pushUndoToast(`deleted view ${gone.name}`, () => {
                    setViews(vs => [...vs.slice(0, i), gone, ...vs.slice(i)])
                    setActive(i)
                })
            }}
            onMove={(i, dir) => {
                const j = i + dir
                if (j < 0 || j >= views().length) return
                setViews(vs => {
                    const next = [...vs]
                    ;[next[i], next[j]] = [next[j], next[i]]
                    return next
                })
                setActive(j)
            }}
            onChangeType={(i, type) => at(i, { type })}
            onToggleMode={i =>
                at(i, {
                    mode: views()[i].mode === 'tasks' ? 'normal' : 'tasks',
                })
            }
            onOpenSettings={() => {}}
        />
        {/* Test-only readout of the live state the strip's actions write. */}
        <div
            data-kinds={views()
                .map(v => `${v.type}:${v.mode}`)
                .join(',')}
        />
        </div>
    )
}

/** A real base file: full affordances. `[+]` adds a view, double-click renames, right-click
 *  (or Shift+F10) opens rename / duplicate / change kind / tasks mode / move / delete. */
export const Editable: Story = {
    args: tabArgs(THREE_VIEWS, 1, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={1} />,
    play: async ({ canvasElement }) => {
        const add = canvasElement.querySelector<HTMLElement>(
            'button[aria-label="Add view"]',
        )!
        await userEvent.click(add)
        const item = [...document.body.querySelectorAll<HTMLElement>('*')].find(
            e => e.children.length === 0 && e.textContent?.trim() === 'Map',
        )!
        await userEvent.click(item)
        await new Promise(r => setTimeout(r, 0))
        expect(canvasElement.textContent).toContain('Map')
    },
}

/** Editable with only one view — the strip still shows so `[+]` stays reachable. */
export const SingleView: Story = {
    args: tabArgs([THREE_VIEWS[0]], 0, true),
    render: () => <LiveTabs initial={[THREE_VIEWS[0]]} active={0} />,
    play: async ({ canvasElement }) => {
        expect(tabLabels(canvasElement)).toEqual(['Table'])
        expect(
            canvasElement.querySelector('button[aria-label="Add view"]'),
        ).toBeTruthy()
    },
}

/** An embedded ```query block — no editPath, so no rename/menu/add: plain tabs. */
export const NotEditable: Story = {
    args: tabArgs(THREE_VIEWS, 0, false),
    render: () => (
        <LiveTabs initial={THREE_VIEWS} active={0} editable={false} />
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('button[aria-label="Add view"]')).toBeNull()
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: tabButton(canvasElement, 'Board'),
        })
        expect(menuRow('rename')).toBeUndefined()
        await userEvent.dblClick(tabButton(canvasElement, 'Board'))
        expect(canvasElement.querySelector('input')).toBeNull()
    },
}

/** Five views, to try reordering and deleting by hand. */
export const ManyViews: Story = {
    args: tabArgs(THREE_VIEWS, 2, true),
    render: () => (
        <LiveTabs
            initial={[
                { name: 'Table', type: 'table', mode: 'normal' },
                { name: 'Cards', type: 'cards', mode: 'normal' },
                { name: 'Board', type: 'kanban', mode: 'tasks' },
                { name: 'Calendar', type: 'calendar', mode: 'normal' },
                { name: 'Deck', type: 'flashcards', mode: 'normal' },
            ]}
            active={2}
        />
    ),
    play: async ({ canvasElement }) => {
        expect(tabLabels(canvasElement)).toEqual([
            'Table',
            'Cards',
            'Board',
            'Calendar',
            'Deck',
        ])
    },
}

/** Double-click a tab and it becomes a field; Enter commits the new name into the strip. */
export const Rename: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={0} />,
    play: async ({ canvasElement }) => {
        await userEvent.dblClick(tabButton(canvasElement, 'Board'))
        const input = await within(canvasElement).findByLabelText(
            'Rename Board view',
        )
        await userEvent.clear(input)
        await userEvent.type(input, 'Sprint{Enter}')
        await waitFor(() =>
            expect(tabLabels(canvasElement)).toEqual([
                'Table',
                'Sprint',
                'Calendar',
            ]),
        )
    },
}

/** Right-click opens the tab menu with all eight rows; Escape closes it. */
export const ContextMenuRows: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={0} />,
    play: async ({ canvasElement }) => {
        await openMenu(canvasElement, 'Board')
        for (const label of [
            'rename',
            'duplicate',
            'change kind',
            'turn off tasks mode',
            'move left',
            'move right',
            'view settings',
            'delete',
        ])
            expect(menuRow(label)).toBeTruthy()
    },
}

/** Shift+F10 on a focused tab opens the same menu (the ContextMenu key does too). */
export const ShiftF10Menu: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={0} />,
    play: async ({ canvasElement }) => {
        tabButton(canvasElement, 'Calendar').focus()
        await userEvent.keyboard('{Shift>}{F10}{/Shift}')
        await waitFor(() => expect(menuRow('duplicate')).toBeTruthy())
    },
}

/** "duplicate" inserts a copy right after the tab. */
export const Duplicate: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={0} />,
    play: async ({ canvasElement }) => {
        await openMenu(canvasElement, 'Table')
        await userEvent.click(menuRow('duplicate')!)
        await waitFor(() =>
            expect(tabLabels(canvasElement)).toEqual([
                'Table',
                'Table 2',
                'Board',
                'Calendar',
            ]),
        )
    },
}

/** "move right" swaps the tab with its neighbour. */
export const MoveRight: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={0} />,
    play: async ({ canvasElement }) => {
        await openMenu(canvasElement, 'Table')
        await userEvent.click(menuRow('move right')!)
        await waitFor(() =>
            expect(tabLabels(canvasElement)).toEqual([
                'Board',
                'Table',
                'Calendar',
            ]),
        )
    },
}

/** "change kind" flies out the other kinds; picking one rewrites that view's kind. */
export const ChangeKind: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={0} />,
    play: async ({ canvasElement }) => {
        await openMenu(canvasElement, 'Table')
        await userEvent.hover(menuRow('change kind')!)
        await waitFor(() => expect(menuRow('Cards')).toBeTruthy())
        // The current kind is not offered.
        expect(menuRow('Table')).toBeUndefined()
        await userEvent.click(menuRow('Cards')!)
        await waitFor(() =>
            expect(kinds(canvasElement)).toBe(
                'cards:normal,kanban:tasks,calendar:normal',
            ),
        )
    },
}

/** The mode row names what it will do, and flips the view's mode. */
export const ToggleMode: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => <LiveTabs initial={THREE_VIEWS} active={0} />,
    play: async ({ canvasElement }) => {
        await openMenu(canvasElement, 'Table')
        await userEvent.click(menuRow('turn on tasks mode')!)
        await waitFor(() =>
            expect(kinds(canvasElement)).toBe(
                'table:tasks,kanban:tasks,calendar:normal',
            ),
        )
        await openMenu(canvasElement, 'Board')
        expect(menuRow('turn off tasks mode')).toBeTruthy()
    },
}

/** Delete is one flat row — no submenu, no confirm. Choosing it removes the tab at once and
 *  raises the undo toast. */
export const DeleteIsImmediate: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => (
        <div>
            <LiveTabs initial={THREE_VIEWS} active={0} />
            <ToastHost />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await openMenu(canvasElement, 'Board')
        expect(menuRow('confirm delete')).toBeUndefined()
        await userEvent.click(menuRow('delete')!)
        await waitFor(() =>
            expect(tabLabels(canvasElement)).toEqual(['Table', 'Calendar']),
        )
        // The toast's action reads `[undo]` — the brackets are the button's styling.
        const toast = await within(canvasElement).findByText('deleted view Board')
        const undo = within(toast.parentElement!).getByRole('button', {
            name: 'undo',
        })
        await userEvent.click(undo)
        await waitFor(() =>
            expect(tabLabels(canvasElement)).toEqual([
                'Table',
                'Board',
                'Calendar',
            ]),
        )
    },
}

/** The disabled states: the first tab cannot move left, the last cannot move right, and the
 *  only view cannot be deleted. */
export const DisabledStates: Story = {
    args: tabArgs(THREE_VIEWS, 0, true),
    render: () => (
        <div>
            <LiveTabs initial={THREE_VIEWS} active={0} />
            <LiveTabs initial={[THREE_VIEWS[0]]} active={0} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const strips = canvasElement.querySelectorAll<HTMLElement>(
            '[data-view-tabs]',
        )
        await openMenu(strips[0].parentElement!, 'Table')
        expect(rowDisabled('move left')).toBe(true)
        expect(rowDisabled('move right')).toBe(false)
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(menuRow('rename')).toBeUndefined())
        await openMenu(strips[0].parentElement!, 'Calendar')
        expect(rowDisabled('move right')).toBe(true)
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(menuRow('rename')).toBeUndefined())
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: tabButton(strips[1].parentElement!, 'Table'),
        })
        await waitFor(() => expect(menuRow('delete')).toBeTruthy())
        expect(rowDisabled('delete')).toBe(true)
    },
}
