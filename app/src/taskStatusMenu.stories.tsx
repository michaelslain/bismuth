// Visual spec for the task-status right-click menu — NOT a Solid component (see
// taskStatusMenu.tsx's file header: it exports option data, pure filtering helpers, and an
// IMPERATIVE opener, `openTaskStatusMenu`, that mounts the shared <ContextMenu> straight onto
// `document.body` via `solid-js/web`'s `render()` for callers outside Solid's tree — the
// CodeMirror live-preview checkbox widget). `app/src/ContextMenu.stories.tsx` already covers
// <ContextMenu>'s generic positioning/dismiss/submenu behaviour, so the story here has one job:
// the task-specific CONTENT — `taskStatusItems()` filtering the current status out of the menu
// (per `isCurrentStatus`'s `x`/`X` and `/`/`\` alias folding) — driven through the real
// imperative entry point every non-Solid caller uses, not a hand-rolled `<ContextMenu>` render
// that would only prove the generic component works (already proven elsewhere).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { onCleanup, onMount } from 'solid-js'
import { expect, waitFor, within } from 'storybook/test'
import {
    openTaskStatusMenu,
    isCurrentStatus,
    TASK_STATUS_OPTIONS,
} from './taskStatusMenu'

const meta = {
    title: 'App/TaskStatusMenu',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Mounts the REAL `openTaskStatusMenu(x, y, cur, onPick)` on mount (matching the CodeMirror
 *  widget's own call — a right-click handler invoking this exact function) and cleans up on
 *  unmount, since the opener attaches directly to `document.body` outside this component's own
 *  subtree and would otherwise leak into the next story. */
function OpenTaskStatusMenu(props: {
    x: number
    y: number
    cur: string
    onPick: (char: string) => void
}) {
    onMount(() => {
        // openTaskStatusMenu appends an untagged host <div> straight to document.body with no
        // reference handed back — diff body's children before/after (render() mounts
        // synchronously) to capture exactly the node it created, so cleanup removes THIS
        // story's host and nothing else, even if several stories mount across a session.
        const before = new Set(Array.from(document.body.children))
        openTaskStatusMenu(props.x, props.y, props.cur, props.onPick)
        const host = Array.from(document.body.children).find(
            el => !before.has(el),
        )
        // openTaskStatusMenu is self-disposing on pick/Escape/outside-click (removes its own
        // host then), so this is a no-op in that case — it only matters for a story
        // remount/navigation away while the menu is still open.
        onCleanup(() => host?.remove())
    })
    return null
}

const noop = () => {}

/** A "To do" task (` `): every OTHER status is offered — "To do" itself is filtered out. */
export const CurrentlyTodo: Story = {
    render: () => <OpenTaskStatusMenu x={120} y={100} cur=" " onPick={noop} />,
    play: async () => {
        const body = within(document.body)
        await waitFor(() =>
            expect(body.getByText('In progress')).toBeInTheDocument(),
        )
        await expect(body.getByText('Done')).toBeInTheDocument()
        await expect(body.getByText('Cancelled')).toBeInTheDocument()
        await expect(body.queryByText('To do')).not.toBeInTheDocument()
    },
}

/** A "Done" task using the alias char `X` (uppercase) — `isCurrentStatus` folds it to the same
 *  status as lowercase `x`, so "Done" is filtered out here too, not offered as a no-op pick. */
export const CurrentlyDoneUppercaseAlias: Story = {
    render: () => <OpenTaskStatusMenu x={120} y={100} cur="X" onPick={noop} />,
    play: async () => {
        const body = within(document.body)
        await waitFor(() => expect(body.getByText('To do')).toBeInTheDocument())
        await expect(body.queryByText('Done')).not.toBeInTheDocument()
    },
}

/** An "In progress" task using the backslash alias (`\`, some editors' escaped form of `/`) —
 *  folded to the same status, so "In progress" is filtered out. */
export const CurrentlyInProgressBackslashAlias: Story = {
    render: () => (
        <OpenTaskStatusMenu x={120} y={100} cur={'\\'} onPick={noop} />
    ),
    play: async () => {
        const body = within(document.body)
        await waitFor(() => expect(body.getByText('To do')).toBeInTheDocument())
        await expect(body.queryByText('In progress')).not.toBeInTheDocument()
    },
}

/** Picking a row calls the real `onPick(char)` the CodeMirror widget uses to rewrite the box
 *  char, and the menu self-disposes (per taskStatusMenu.tsx's `close()`) — asserted by the row
 *  disappearing from the document after the click. */
export const PickClosesMenu: Story = {
    render: () => {
        const picked: string[] = []
        ;(window as unknown as { __picked: string[] }).__picked = picked
        return (
            <OpenTaskStatusMenu
                x={120}
                y={100}
                cur=" "
                onPick={c => picked.push(c)}
            />
        )
    },
    play: async () => {
        const body = within(document.body)
        const done = await waitFor(() => body.getByText('Done'))
        done.click()
        await waitFor(() =>
            expect(body.queryByText('Done')).not.toBeInTheDocument(),
        )
        await expect(
            (window as unknown as { __picked: string[] }).__picked,
        ).toEqual(['x'])
    },
}

/** Documents the pure filtering logic directly (no menu, no DOM) for the alias table
 *  `isCurrentStatus` folds — a quick sanity render of `TASK_STATUS_OPTIONS` so the four
 *  statuses stay visible as a reference alongside the interactive stories above. */
export const OptionReference: Story = {
    render: () => (
        <div
            style={{
                padding: '24px',
                display: 'flex',
                'flex-direction': 'column',
                gap: '8px',
                'font-family': 'var(--ui-font-stack)',
                'font-size': '13px',
                color: 'var(--fg)',
            }}
        >
            {TASK_STATUS_OPTIONS.map(o => (
                <div>
                    [{o.char === ' ' ? '␣' : o.char}] {o.label} — hidden when
                    current is "{o.char === ' ' ? '␣' : o.char}":{' '}
                    {String(isCurrentStatus(o.char, o.char))}
                </div>
            ))}
        </div>
    ),
}
