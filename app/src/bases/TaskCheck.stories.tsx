// Visual spec for <TaskCheck> — the checkbox glyph shared by <TaskRow> (list/bullets/cards/
// kanban in tasks mode) and the TABLE's `status` cell. All four glyph states side by side,
// because each is a separate `[data-status='…'] .ck*` rule and three of them were previously
// only ever reachable through a right-click menu inside a list view.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import TaskCheck, { type TaskCheckStatus } from './TaskCheck'

const meta = {
    title: 'Bases/TaskCheck',
    component: TaskCheck,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof TaskCheck>

export default meta
type Story = StoryObj<typeof meta>

const STATES: TaskCheckStatus[] = ['todo', 'doing', 'done', 'cancelled']

const noop = () => {}

/** What the AllStates play drives through the keyboard: every call the FIRST mark hands back,
 *  recorded as the event type it arrived with. A module-level array rather than a Storybook
 *  `fn()` mock, matching FileTree.stories.tsx's `dragStarts` counter. */
const keyCalls: string[] = []
const recordToggle = (e: Event) => keyCalls.push(`toggle:${e.type}`)
const recordMenu = (e: MouseEvent) =>
    keyCalls.push(
        `menu:${e.type}:${Number.isFinite(e.clientX) && Number.isFinite(e.clientY)}`,
    )

/** Every state at once: empty box, purple slash, filled check, grey dash. A single-state story
 *  would leave three rules with no visual coverage at all — they differ only by an opacity flip
 *  on a glyph that is always mounted, which is precisely the kind of rule a DOM count cannot
 *  tell apart from a missing one. */
export const AllStates: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '18px', 'align-items': 'center' }}>
            {STATES.map((s, i) => (
                <TaskCheck
                    status={s}
                    onToggle={i === 0 ? recordToggle : noop}
                    onSetStatus={i === 0 ? recordMenu : noop}
                />
            ))}
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const boxes = canvas.getAllByTitle(
            'Toggle task — right-click to set status',
        )
        expect(boxes.length).toBe(STATES.length)
        // `data-status` is a RUNTIME hook — the stylesheet matches on it — so a rename would
        // silently unstyle every box while every element still rendered. Pin the values.
        expect(boxes.map(b => b.getAttribute('data-status'))).toEqual(STATES)

        // `role="checkbox"` promises a keyboard path: the mark is tabbable, Space and Enter
        // toggle, Shift+F10 opens the status menu with real coordinates to anchor it at.
        keyCalls.length = 0
        await userEvent.tab()
        expect(document.activeElement).toBe(boxes[0])
        await userEvent.keyboard(' ')
        expect(keyCalls).toEqual(['toggle:keydown'])
        await userEvent.keyboard('{Enter}')
        expect(keyCalls).toEqual(['toggle:keydown', 'toggle:keydown'])
        await userEvent.keyboard('{Shift>}{F10}{/Shift}')
        expect(keyCalls).toEqual([
            'toggle:keydown',
            'toggle:keydown',
            'menu:contextmenu:true',
        ])
    },
}

/** The `cell` variant, as the table renders it: the same mark, standing alone rather than
 *  inside <TaskRow>'s flex line. Without `display: inline-flex` an inline <span> drops its
 *  width/height entirely and the box collapses to nothing — a failure that looks like "the
 *  checkbox did not render" rather than "the variant is missing". */
export const CellVariant: Story = {
    render: () => (
        <table>
            <tbody>
                <tr>
                    <td>
                        <TaskCheck
                            variant="cell"
                            status="todo"
                            onToggle={noop}
                            onSetStatus={noop}
                        />
                    </td>
                    <td>ship the parser</td>
                </tr>
            </tbody>
        </table>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const box = canvas.getByTitle('Toggle task — right-click to set status')
        // A collapsed inline span measures 0×0; the box is ~1.08em square.
        expect(box.getBoundingClientRect().width).toBeGreaterThan(8)
        expect(box.getBoundingClientRect().height).toBeGreaterThan(8)
    },
}
