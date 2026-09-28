// Visual spec for <ViewTabs> — the base's view-tab strip: SegmentedToggle-look tabs plus
// add/rename/duplicate/reorder/change-kind/toggle-mode/delete, gated on `editable`.
//
// The editable stories hold the views in a SIGNAL and apply every action to it, so the strip can
// be tried by hand: `[+]` really adds a tab, the right-click menu really renames/moves/deletes.
// In the app the same actions rewrite the base file's `views:` array (BaseView.tsx +
// viewsEdit.ts); here the signal stands in for that write.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent } from 'storybook/test'
import type { ViewType } from '../../../core/src/bases/types'
import { BASE_VIEW_KINDS } from '../baseViews'
import ViewTabs, { type ViewTabInfo } from './ViewTabs'

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
    BASE_VIEW_KINDS.find(k => k.view === type)?.label ?? type

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
                setViews(vs => vs.filter((_, j) => j !== i))
                setActive(Math.max(0, i - 1))
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
    )
}

/** A real base file: full affordances. `[+]` adds a view, double-click renames, right-click
 *  (or Shift+F10) opens rename / duplicate / change kind / tasks mode / move / delete. */
export const Editable: Story = {
    args: { views: THREE_VIEWS, active: 1, editable: true } as never,
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
    args: { views: [THREE_VIEWS[0]], active: 0, editable: true } as never,
    render: () => <LiveTabs initial={[THREE_VIEWS[0]]} active={0} />,
}

/** An embedded ```query block — no editPath, so no rename/menu/add: plain tabs. */
export const NotEditable: Story = {
    args: { views: THREE_VIEWS, active: 0, editable: false } as never,
    render: () => (
        <LiveTabs initial={THREE_VIEWS} active={0} editable={false} />
    ),
}

/** Five views, to try reordering and deleting by hand. */
export const ManyViews: Story = {
    args: { views: THREE_VIEWS, active: 2, editable: true } as never,
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
}
